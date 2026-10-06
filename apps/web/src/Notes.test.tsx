// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer } from './test/fake-server';

const MODEL = { id: 'modell-a', vision: false, tools: false, reasoning: false, streaming: true };

function setup() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A');
  const group = server.addGroup(subject.id, 'Beispiel-Gruppe');
  const provider = server.addProvider('Anbieter A', {
    models: [{ ...MODEL, free: false }],
    hasKey: true,
  });
  server.modelSettings = { default: { providerId: provider.id, model: 'modell-a' }, fallback: [] };
  return { server, subject, group };
}

function open(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

beforeAll(async () => {
  await Promise.all([
    import('./screens/chat/ChatPage'),
    import('./screens/notes/NotePage'),
    import('./screens/chat/blocks/MathView'),
    import('./screens/chat/blocks/BlockView'),
    import('@pagewise/render/graph'),
    import('@pagewise/render/mol'),
    import('@pagewise/render/sanitize'),
    import('@pagewise/render/validate'),
  ]);
}, 30_000);

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

const NOT_FOUND = /gibt es nicht/i;

const notesPath = (subjectId: string) => `/subjects/${subjectId}/notes`;
const notePath = (subjectId: string, noteId: string) => `/subjects/${subjectId}/notes/${noteId}`;

describe('Fachseite: Reiter Chats und Hefteinträge', () => {
  it('zeigt standardmäßig die Chats und wechselt per Klick und Pfeiltaste zu den Hefteinträgen', async () => {
    const { server, subject } = setup();
    server.addNote(subject.id, { title: 'Erster Eintrag', markdown: 'Ein Satz hier.' });
    open(server, `/subjects/${subject.id}`);
    const user = userEvent.setup();
    const tabs = await screen.findByRole('tablist', { name: 'Inhalt' });
    const chats = within(tabs).getByRole('tab', { name: 'Chats' });
    const notes = within(tabs).getByRole('tab', { name: 'Hefteinträge' });
    expect(chats.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('Noch keine Chats')).toBeTruthy();

    await user.click(notes);
    expect(window.location.pathname).toBe(notesPath(subject.id));
    expect(await screen.findByText('Erster Eintrag')).toBeTruthy();
    expect(screen.getByText(/Ein Satz hier\./)).toBeTruthy();
    expect(notes.getAttribute('aria-selected')).toBe('true');
    expect(notes.getAttribute('tabindex')).toBe('0');
    expect(chats.getAttribute('tabindex')).toBe('-1');

    // Pfeiltasten wechseln und halten den Fokus im Reiter
    chats.focus();
    await user.keyboard('{ArrowRight}');
    expect(window.location.pathname).toBe(notesPath(subject.id));
    await user.keyboard('{ArrowLeft}');
    expect(window.location.pathname).toBe(`/subjects/${subject.id}`);
    expect(document.activeElement).toBe(chats);
  });

  it('öffnet die Hefteinträge direkt über die Adresse, auch in einer Untergruppe', async () => {
    const { server, subject, group } = setup();
    server.addNote(subject.id, { title: 'Allgemein-Eintrag' });
    server.addNote(subject.id, { title: 'Gruppen-Eintrag', groupId: group.id });
    open(server, `/subjects/${subject.id}/groups/${group.id}/notes`);
    expect(await screen.findByText('Gruppen-Eintrag')).toBeTruthy();
    expect(screen.queryByText('Allgemein-Eintrag')).toBeNull();
  });
});

describe('Liste der Hefteinträge', () => {
  it('zeigt einen Leerzustand', async () => {
    const { server, subject } = setup();
    open(server, notesPath(subject.id));
    expect(await screen.findByText('Noch keine Hefteinträge')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Neuer Hefteintrag' })).toBeTruthy();
  });

  it('zeigt Angeheftete zuerst mit Hinweis und die Herkunft aus einem Chat', async () => {
    const { server, subject } = setup();
    server.addNote(subject.id, { title: 'Normal', updatedAt: Date.now() });
    server.addNote(subject.id, { title: 'Wichtig', pinned: true, updatedAt: Date.now() - 100000 });
    server.addNote(subject.id, {
      title: 'Aus Chat',
      sourceChatId: 'c1',
      updatedAt: Date.now() - 200000,
    });
    open(server, notesPath(subject.id));
    await screen.findByText('Wichtig');
    const list = within(screen.getByRole('region', { name: 'Hefteinträge' }));
    const titles = list.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(titles[0]).toContain('Wichtig');
    expect(titles[0]).toContain('Angeheftet');
    expect(titles[2]).toContain('Aus einem Chat');
  });

  it('sucht auf dem Server in Titel und Text und meldet, wenn nichts passt', async () => {
    const { server, subject } = setup();
    server.addNote(subject.id, { title: 'Stoffmenge', markdown: 'n = m / M' });
    server.addNote(subject.id, { title: 'Latein', markdown: 'Vokabeln' });
    open(server, notesPath(subject.id));
    const user = userEvent.setup();
    await screen.findByText('Stoffmenge');
    await user.type(screen.getByRole('searchbox', { name: 'Hefteinträge durchsuchen' }), 'vokab');
    await waitFor(() => expect(screen.queryByText('Stoffmenge')).toBeNull());
    expect(screen.getByText('Latein')).toBeTruthy();
    expect(
      server.calls('GET', `/api/notes?subjectId=${subject.id}&q=vokab`).length,
    ).toBeGreaterThan(0);
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'gibtsnicht');
    expect(await screen.findByText('Nichts gefunden.')).toBeTruthy();
  });

  it('legt einen neuen Eintrag an und öffnet den Editor', async () => {
    const { server, subject, group } = setup();
    open(server, `/subjects/${subject.id}/groups/${group.id}/notes`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Neuer Hefteintrag' }));
    await waitFor(() => expect(window.location.pathname).toContain('/notes/'));
    expect(server.calls('POST', '/api/notes')[0]?.body).toEqual({
      subjectId: subject.id,
      groupId: group.id,
      title: 'Neuer Hefteintrag',
    });
    expect(await screen.findByRole('textbox', { name: 'Titel' })).toBeTruthy();
  });

  it('löscht nach Bestätigung', async () => {
    const { server, subject } = setup();
    const note = server.addNote(subject.id, { title: 'Weg damit' });
    open(server, notesPath(subject.id));
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Hefteintrag „Weg damit“ löschen' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Hefteintrag „Weg damit“ löschen?')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(screen.queryByText('Weg damit')).toBeNull());
    expect(server.calls('DELETE', `/api/notes/${note.id}`)).toHaveLength(1);
    expect(server.notes).toHaveLength(0);
  });

  it('zeigt einen Fehlerzustand, wenn die Liste nicht lädt', async () => {
    const { server, subject } = setup();
    server.replyOnce(
      'GET',
      `/api/notes?subjectId=${subject.id}`,
      () => new Response(null, { status: 500 }),
    );
    open(server, notesPath(subject.id));
    expect(await screen.findByText('Die Hefteinträge konnten nicht geladen werden.')).toBeTruthy();
  });
});

describe('Editor', () => {
  it('lädt den Eintrag, zeigt die Vorschau und speichert Änderungen automatisch', async () => {
    const { server, subject } = setup();
    const note = server.addNote(subject.id, { title: 'Mein Eintrag', markdown: 'Start' });
    open(server, notePath(subject.id, note.id));
    const user = userEvent.setup();
    const text = (await screen.findByRole('textbox', {
      name: 'Text (Markdown)',
    })) as HTMLTextAreaElement;
    expect(text.value).toBe('Start');
    expect((screen.getByRole('textbox', { name: 'Titel' }) as HTMLInputElement).value).toBe(
      'Mein Eintrag',
    );
    expect(screen.getByText('Gespeichert')).toBeTruthy();

    await user.clear(text);
    await user.click(text);
    await user.paste('Das ist **wichtig** und $a^2$.');
    expect(screen.getByText('Nicht gespeichert')).toBeTruthy();
    // Vorschau ohne Warten
    const preview = screen.getByRole('region', { name: 'Vorschau' });
    expect(within(preview).getByText('wichtig').tagName).toBe('STRONG');
    await waitFor(() => expect(preview.querySelector('.katex')).not.toBeNull());

    await waitFor(() => expect(server.calls('PATCH', `/api/notes/${note.id}`)).toHaveLength(1), {
      timeout: 4000,
    });
    expect(server.calls('PATCH', `/api/notes/${note.id}`)[0]?.body).toEqual({
      title: 'Mein Eintrag',
      markdown: 'Das ist **wichtig** und $a^2$.',
      pinned: false,
      tags: [],
    });
    expect(await screen.findByText('Gespeichert')).toBeTruthy();
    expect(server.notes[0]?.markdown).toBe('Das ist **wichtig** und $a^2$.');
  });

  it('fasst schnelle Änderungen zu einem Speichern zusammen', async () => {
    const { server, subject } = setup();
    const note = server.addNote(subject.id, { markdown: '' });
    open(server, notePath(subject.id, note.id));
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Text (Markdown)' }), 'abc');
    await waitFor(() => expect(server.calls('PATCH', `/api/notes/${note.id}`)).toHaveLength(1), {
      timeout: 4000,
    });
    expect(server.calls('PATCH', `/api/notes/${note.id}`)[0]?.body).toMatchObject({
      markdown: 'abc',
    });
  });

  it('fügt Vorlagen an der Schreibmarke ein und zeichnet sie in der Vorschau', async () => {
    const { server, subject } = setup();
    const note = server.addNote(subject.id, { markdown: 'Anfang' });
    open(server, notePath(subject.id, note.id));
    const user = userEvent.setup();
    const text = (await screen.findByRole('textbox', {
      name: 'Text (Markdown)',
    })) as HTMLTextAreaElement;
    text.setSelectionRange(6, 6);
    await user.click(screen.getByRole('button', { name: 'Funktionsgraph' }));
    expect(text.value.startsWith('Anfang\n\n```graph\n')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Molekül' }));
    await user.click(screen.getByRole('button', { name: 'Merksatz' }));
    const preview = screen.getByRole('region', { name: 'Vorschau' });
    await waitFor(() => expect(preview.querySelector('svg.pg-graph')).not.toBeNull());
    await waitFor(() => expect(preview.querySelector('svg.pg-mol')).not.toBeNull());
    expect(preview.querySelector('aside[data-callout="merksatz"]')).not.toBeNull();
  });

  it('lehnt einen leeren Titel ab und speichert dann nicht', async () => {
    const { server, subject } = setup();
    const note = server.addNote(subject.id, { title: 'Titel' });
    open(server, notePath(subject.id, note.id));
    const user = userEvent.setup();
    const title = await screen.findByRole('textbox', { name: 'Titel' });
    await user.clear(title);
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Der Titel braucht 1 bis 120 Zeichen.')).toBeTruthy();
    expect(title.getAttribute('aria-invalid')).toBe('true');
    // Leerer Titel bleibt sichtbar: Platzhalter aus i18n statt leere Fläche (notes#11)
    expect(title.getAttribute('placeholder')).toBe('Titel');
    expect(screen.getByPlaceholderText('Titel')).toBe(title);
    expect(server.calls('PATCH', `/api/notes/${note.id}`)).toHaveLength(0);
  });

  it('heftet an, setzt Stichwörter und speichert beides', async () => {
    const { server, subject } = setup();
    const note = server.addNote(subject.id, { title: 'Titel' });
    open(server, notePath(subject.id, note.id));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Anheften' }));
    // Wechselnder Name ohne aria-pressed: der Name selbst nennt die Wirkung.
    expect(
      screen.getByRole('button', { name: 'Anheftung lösen' }).hasAttribute('aria-pressed'),
    ).toBe(false);
    await user.type(screen.getByRole('textbox', { name: 'Stichwörter' }), 'Mol, Test, mol');
    await waitFor(
      () => expect(server.calls('PATCH', `/api/notes/${note.id}`).length).toBeGreaterThan(0),
      {
        timeout: 4000,
      },
    );
    await waitFor(
      () => expect(server.notes[0]).toMatchObject({ pinned: true, tags: ['Mol', 'Test'] }),
      {
        timeout: 4000,
      },
    );
  });

  it('meldet einen fehlgeschlagenen Speichervorgang, ohne die Eingabe zu verlieren', async () => {
    const { server, subject } = setup();
    const note = server.addNote(subject.id, { markdown: '' });
    open(server, notePath(subject.id, note.id));
    const user = userEvent.setup();
    server.replyOnce('PATCH', `/api/notes/${note.id}`, () => new Response(null, { status: 500 }));
    const text = (await screen.findByRole('textbox', {
      name: 'Text (Markdown)',
    })) as HTMLTextAreaElement;
    await user.type(text, 'wichtig');
    expect(
      await screen.findByText(
        'Speichern fehlgeschlagen. Deine Änderungen stehen noch hier.',
        {},
        { timeout: 4000 },
      ),
    ).toBeTruthy();
    expect(text.value).toBe('wichtig');
    // Erneut speichern gelingt
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Gespeichert')).toBeTruthy();
    expect(server.notes[0]?.markdown).toBe('wichtig');
  });

  it('schickt ungespeicherte Änderungen beim Verlassen noch ab', async () => {
    const { server, subject } = setup();
    const note = server.addNote(subject.id, { markdown: '' });
    open(server, notePath(subject.id, note.id));
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('textbox', { name: 'Text (Markdown)' }),
      'noch schnell',
    );
    await user.click(screen.getByRole('link', { name: /Zurück zu den Hefteinträgen/ }));
    await waitFor(() => expect(server.notes[0]?.markdown).toBe('noch schnell'));
    expect(window.location.pathname).toBe(notesPath(subject.id));
  });

  it('löscht nach Bestätigung und kehrt zur Liste zurück', async () => {
    const { server, subject } = setup();
    const note = server.addNote(subject.id, { title: 'Zu löschen' });
    open(server, notePath(subject.id, note.id));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Löschen' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(window.location.pathname).toBe(notesPath(subject.id)));
    expect(server.notes).toHaveLength(0);
  });

  it('zeigt „nicht gefunden“ für einen unbekannten Eintrag', async () => {
    const { server, subject } = setup();
    open(server, notePath(subject.id, 'unbekannt'));
    expect(await screen.findByRole('heading', { name: NOT_FOUND })).toBeTruthy();
  });

  it('zeigt „nicht gefunden“, wenn der Eintrag zu einem anderen Fach gehört', async () => {
    const { server, subject } = setup();
    const other = server.addSubject('Beispielfach B');
    const note = server.addNote(other.id, { title: 'Fremd' });
    open(server, notePath(subject.id, note.id));
    expect(await screen.findByRole('heading', { name: NOT_FOUND })).toBeTruthy();
  });

  it('bringt Skripte und Markup aus dem Text nicht ins DOM', async () => {
    const { server, subject } = setup();
    const note = server.addNote(subject.id, {
      markdown:
        '<script>window.__angriff=1</script>\n\n<img src=x onerror="window.__angriff=2">\n\n[x](javascript:window.__angriff=3)',
    });
    open(server, notePath(subject.id, note.id));
    const preview = await screen.findByRole('region', { name: 'Vorschau' });
    await within(preview).findByText(/<script>/);
    expect(preview.querySelector('script, img, [onerror]')).toBeNull();
    expect(preview.querySelector('a[href^="javascript:"]')).toBeNull();
    expect((window as unknown as { __angriff?: number }).__angriff).toBeUndefined();
  });

  it('nennt Eintrag und Fach im Tab-Titel und in der Seitenüberschrift', async () => {
    const { server, subject } = setup();
    const note = server.addNote(subject.id, { title: 'Mein Eintrag', markdown: 'Start' });
    open(server, notePath(subject.id, note.id));
    expect(await screen.findByRole('heading', { name: 'Mein Eintrag', level: 1 })).toBeTruthy();
    await screen.findByRole('textbox', { name: 'Titel' });
    expect(document.title).toBe('Mein Eintrag · Beispielfach A · Pagewise');

    // Leerer Titel: sinnvoller Platzhalter statt leerer Überschrift
    const user = userEvent.setup();
    await user.clear(screen.getByRole('textbox', { name: 'Titel' }));
    expect(await screen.findByRole('heading', { name: 'Ohne Titel', level: 1 })).toBeTruthy();
    expect(document.title).toBe('Ohne Titel · Beispielfach A · Pagewise');
  });
});

describe('Antwort aus dem Chat als Hefteintrag', () => {
  it('speichert die Antwort und führt zum Eintrag', async () => {
    const { server, subject } = setup();
    const chat = server.addChat(subject.id, { title: 'Frage' });
    server.addMessage(chat.id, 'user', 'Erkläre n');
    const answer = server.addMessage(chat.id, 'assistant', '# Stoffmenge\n\nn = m / M', {
      model: 'modell-a',
    });
    open(server, `/subjects/${subject.id}/chats/${chat.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Als Hefteintrag speichern' }));
    expect(await screen.findByRole('link', { name: 'Hefteintrag öffnen' })).toBeTruthy();
    expect(server.calls('POST', `/api/chats/${chat.id}/messages/${answer.id}/note`)).toHaveLength(
      1,
    );
    expect(server.notes[0]).toMatchObject({ title: 'Stoffmenge', sourceChatId: chat.id });
    await user.click(screen.getByRole('link', { name: 'Hefteintrag öffnen' }));
    await waitFor(() =>
      expect(window.location.pathname).toBe(notePath(subject.id, server.notes[0]?.id ?? '')),
    );
    expect(await screen.findByRole('textbox', { name: 'Titel' })).toBeTruthy();
  });

  it('zeigt einen Fehler, wenn das Speichern scheitert, und lässt es erneut zu', async () => {
    const { server, subject } = setup();
    const chat = server.addChat(subject.id, { title: 'Frage' });
    server.addMessage(chat.id, 'user', 'Frage');
    const answer = server.addMessage(chat.id, 'assistant', 'Antwort', { model: 'modell-a' });
    server.replyOnce(
      'POST',
      `/api/chats/${chat.id}/messages/${answer.id}/note`,
      () => new Response(null, { status: 500 }),
    );
    open(server, `/subjects/${subject.id}/chats/${chat.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Als Hefteintrag speichern' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Als Hefteintrag speichern' }));
    expect(await screen.findByRole('link', { name: 'Hefteintrag öffnen' })).toBeTruthy();
  });
});

describe('Automatische Korrektur fehlerhafter Blöcke', () => {
  const BAD = 'Hier der Graph:\n\n```graph\n{"functions":["foo(x)"]}\n```';

  async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.click(await screen.findByRole('textbox', { name: 'Nachricht' }));
    await user.paste(text);
    await user.click(screen.getByRole('button', { name: 'Senden' }));
  }

  it('schickt einmal die Fehlercodes an das Modell und danach nie wieder', async () => {
    const { server, subject } = setup();
    const chat = server.addChat(subject.id);
    open(server, `/subjects/${subject.id}/chats/${chat.id}`);
    const user = userEvent.setup();
    await ask(user, 'Zeichne x');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    act(() => {
      server.generation(chat.id).delta(BAD);
      server.generation(chat.id).finish();
    });

    // Die Korrekturanfrage geht automatisch hinaus und steht sichtbar im Verlauf
    await waitFor(
      () => expect(server.calls('POST', `/api/chats/${chat.id}/messages`)).toHaveLength(2),
      {
        timeout: 5000,
      },
    );
    const body = server.calls('POST', `/api/chats/${chat.id}/messages`)[1]?.body as {
      content: string;
    };
    expect(body.content.startsWith('Automatische Prüfung:')).toBe(true);
    expect(body.content).toContain(
      'Funktionsgraph 1: Ein Ausdruck lässt sich nicht lesen. (invalid_expression: 0)',
    );
    expect(body.content).not.toContain('foo(x)');
    expect(await screen.findByText(/Automatische Prüfung:/)).toBeTruthy();

    // Auch die zweite Antwort ist fehlerhaft: kein dritter Anlauf
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    act(() => {
      server.generation(chat.id).delta(BAD);
      server.generation(chat.id).finish();
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(server.calls('POST', `/api/chats/${chat.id}/messages`)).toHaveLength(2);
  });

  it('korrigiert nichts, wenn alle Blöcke stimmen oder die Antwort keine Blöcke hat', async () => {
    const { server, subject } = setup();
    const chat = server.addChat(subject.id);
    open(server, `/subjects/${subject.id}/chats/${chat.id}`);
    const user = userEvent.setup();
    await ask(user, 'Zeichne x');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    act(() => {
      server
        .generation(chat.id)
        .delta('Gut:\n\n```graph\n{"functions":["x^2"]}\n```\n\nund $a^2$.');
      server.generation(chat.id).finish();
    });
    await screen.findByText(/und/);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(server.calls('POST', `/api/chats/${chat.id}/messages`)).toHaveLength(1);
  });

  it('bleibt aus, wenn die Einstellung ausgeschaltet ist', async () => {
    window.localStorage.setItem('pagewise.autofix', 'off');
    const { server, subject } = setup();
    const chat = server.addChat(subject.id);
    open(server, `/subjects/${subject.id}/chats/${chat.id}`);
    const user = userEvent.setup();
    await ask(user, 'Zeichne x');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    act(() => {
      server.generation(chat.id).delta(BAD);
      server.generation(chat.id).finish();
    });
    await screen.findByText(/Hier der Graph/);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(server.calls('POST', `/api/chats/${chat.id}/messages`)).toHaveLength(1);
  });

  it('schickt beim bloßen Öffnen eines alten Chats nichts', async () => {
    const { server, subject } = setup();
    const chat = server.addChat(subject.id);
    server.addMessage(chat.id, 'user', 'Frage');
    server.addMessage(chat.id, 'assistant', BAD, { model: 'modell-a' });
    open(server, `/subjects/${subject.id}/chats/${chat.id}`);
    await screen.findByText(/Hier der Graph/);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(server.calls('POST', `/api/chats/${chat.id}/messages`)).toHaveLength(0);
  });
});

describe('Einstellungen: Antworten', () => {
  it('schaltet die automatische Korrektur um und merkt sich die Wahl', async () => {
    const server = new FakeServer('unlocked');
    open(server, '/settings');
    const user = userEvent.setup();
    const box = (await screen.findByRole('checkbox', {
      name: /Fehlerhafte Blöcke automatisch korrigieren lassen/,
    })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    await user.click(box);
    expect(window.localStorage.getItem('pagewise.autofix')).toBe('off');
    await user.click(box);
    expect(window.localStorage.getItem('pagewise.autofix')).toBeNull();
  });
});

describe('Vorlagen im Editor', () => {
  it('lassen sich alle zeichnen', async () => {
    const { TEMPLATES } = await import('./screens/notes/templates');
    const { validateMarkdown } = await import('@pagewise/render/validate');
    for (const [key, template] of Object.entries(TEMPLATES)) {
      expect(await validateMarkdown(template), key).toEqual([]);
    }
    fireEvent.click(document.body);
  });
});

describe('Anheften: zugänglicher Name', () => {
  it('wechselt zwischen „Anheften“ und „Anheftung lösen“, ohne aria-pressed', async () => {
    const { server, subject } = setup();
    const note = server.addNote(subject.id, { title: 'Titel' });
    open(server, notePath(subject.id, note.id));
    const user = userEvent.setup();
    const pin = await screen.findByRole('button', { name: 'Anheften' });
    expect(pin.hasAttribute('aria-pressed')).toBe(false);

    await user.click(pin);
    const unpin = screen.getByRole('button', { name: 'Anheftung lösen' });
    expect(unpin.hasAttribute('aria-pressed')).toBe(false);

    await user.click(unpin);
    expect(screen.getByRole('button', { name: 'Anheften' }).hasAttribute('aria-pressed')).toBe(
      false,
    );
  });
});
