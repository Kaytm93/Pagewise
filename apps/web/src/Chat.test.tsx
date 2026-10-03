// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer, json } from './test/fake-server';

const MODEL = { id: 'modell-a', vision: false, tools: false, reasoning: false, streaming: true };

function setup(options: { model?: boolean } = {}) {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A');
  const provider = server.addProvider('Anbieter A', {
    models: [
      { ...MODEL, free: false },
      { ...MODEL, id: 'modell-b', free: false },
    ],
    hasKey: true,
  });
  if (options.model !== false) {
    server.modelSettings = {
      default: { providerId: provider.id, model: 'modell-a' },
      fallback: [],
    };
  }
  const chat = server.addChat(subject.id);
  return { server, subject, provider, chat };
}

function open(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

const chatPath = (subjectId: string, chatId: string) => `/subjects/${subjectId}/chats/${chatId}`;

async function composer() {
  return (await screen.findByRole('textbox', { name: 'Nachricht' })) as HTMLTextAreaElement;
}

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(await composer());
  await user.paste(text);
  await user.click(screen.getByRole('button', { name: 'Senden' }));
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Chat: Antworten', () => {
  it('sendet eine Frage und zeigt die Antwort Stück für Stück als Markdown', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();

    expect(await screen.findByText('Stell deine erste Frage')).toBeTruthy();
    await ask(user, 'Was ist eine Ableitung?');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    expect(server.calls('POST', `/api/chats/${chat.id}/messages`)[0]?.body).toEqual({
      content: 'Was ist eine Ableitung?',
    });

    // Die Frage steht im Verlauf, das Feld ist leer, statt „Senden“ gibt es „Stoppen“.
    expect(await screen.findByText('Was ist eine Ableitung?', { selector: 'p' })).toBeTruthy();
    // Der Titel steht sofort da, nicht erst nach der Antwort.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Was ist eine Ableitung?' }),
    ).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(''),
    );
    expect(screen.getByRole('button', { name: 'Antwort stoppen' })).toBeTruthy();
    expect(screen.getByText('Warte auf das Modell …')).toBeTruthy();

    const generation = server.generation(chat.id);
    act(() => generation.thinking());
    expect(await screen.findByText('Das Modell überlegt …')).toBeTruthy();

    act(() => generation.delta('Die Ableitung ist '));
    expect(await screen.findByText(/Die Ableitung ist/)).toBeTruthy();
    act(() => {
      generation.delta('die **Steigung** einer Funktion.');
      generation.setModel({ providerId: 'p', model: 'modell-a' });
      generation.finish();
    });

    const strong = await screen.findByText('Steigung');
    expect(strong.tagName).toBe('STRONG');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Senden' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Antwort stoppen' })).toBeNull();
    // Der Titel kommt aus der ersten Frage.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Was ist eine Ableitung?' }),
    ).toBeTruthy();
    // Screenreader erfahren das Ende der Antwort, ohne jedes Textstück vorgelesen zu bekommen.
    expect(screen.getByRole('status').textContent).toBe('Die Antwort ist fertig.');
  });

  it('stoppt eine laufende Antwort und lässt den bisherigen Text stehen', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await ask(user, 'Erkläre etwas Langes');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    act(() => server.generation(chat.id).delta('Zuerst das Wichtigste'));
    await screen.findByText('Zuerst das Wichtigste');

    await user.click(screen.getByRole('button', { name: 'Antwort stoppen' }));
    expect(await screen.findByText('Antwort gestoppt.')).toBeTruthy();
    expect(server.calls('POST', `/api/chats/${chat.id}/stop`)).toHaveLength(1);
    expect(screen.getByText('Zuerst das Wichtigste')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Senden' })).toBeTruthy();
  });

  it('zeigt Fehler als Text zum Code, behält den Teiltext und wiederholt die Antwort', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await ask(user, 'Frage');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    act(() => {
      server.generation(chat.id).delta('Halber Sa');
      server.generation(chat.id).fail('rate_limited');
    });

    expect(
      await screen.findByText(
        'Der Anbieter meldet zu viele Anfragen. Versuch es gleich noch einmal.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Halber Sa')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    expect(server.calls('POST', `/api/chats/${chat.id}/retry`)).toHaveLength(1);
    // Die fehlgeschlagene Antwort wird ersetzt, nicht ergänzt.
    expect(screen.queryByText('Halber Sa')).toBeNull();
    act(() => {
      server.generation(chat.id).delta('Jetzt klappt es.');
      server.generation(chat.id).finish();
    });
    expect(await screen.findByText('Jetzt klappt es.')).toBeTruthy();
    expect(screen.queryByText(/zu viele Anfragen/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull();
  });

  it('verweist bei einem abgelehnten Schlüssel auf die Einstellungen', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await ask(user, 'Frage');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    act(() => server.generation(chat.id).fail('auth_failed'));
    expect(await screen.findByText(/lehnt den Schlüssel ab/)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Zu den Einstellungen' });
    expect(link.getAttribute('href')).toBe('/settings');
  });

  it('hängt sich nach einem Verbindungsabbruch wieder an und übernimmt den Stand des Servers', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await ask(user, 'Frage');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    const generation = server.generation(chat.id);
    act(() => generation.delta('Hallo'));
    await screen.findByText('Hallo');

    // Das Gerät verliert die Verbindung; der Server schreibt weiter.
    act(() => {
      generation.drop();
      generation.delta(' und noch mehr');
    });
    expect(await screen.findByText(/Verbindung unterbrochen/)).toBeTruthy();
    await waitFor(
      () => expect(server.calls('GET', `/api/chats/${chat.id}/generation`)).toHaveLength(1),
      {
        timeout: 3000,
      },
    );
    expect(await screen.findByText('Hallo und noch mehr')).toBeTruthy();
    expect(screen.queryByText(/Verbindung unterbrochen/)).toBeNull();

    act(() => {
      generation.delta('.');
      generation.finish();
    });
    expect(await screen.findByText('Hallo und noch mehr.')).toBeTruthy();
    // Die Frage wurde dabei nicht ein zweites Mal gesendet.
    expect(server.calls('POST', `/api/chats/${chat.id}/messages`)).toHaveLength(1);
  });

  it('lädt den gespeicherten Stand, wenn die Antwort während der Abwesenheit fertig wurde', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await ask(user, 'Frage');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    const generation = server.generation(chat.id);
    act(() => generation.delta('Teil'));
    await screen.findByText('Teil');

    act(() => {
      generation.drop();
      generation.delta(' eins');
    });
    // Während der Wartezeit wird die Antwort fertig; das erneute Anhängen findet nichts Laufendes mehr.
    act(() => generation.finish());
    expect(await screen.findByText('Teil eins', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Antwort stoppen' })).toBeNull();
  });

  it('hängt sich beim Öffnen an eine Antwort an, die ein anderes Gerät gestartet hat', async () => {
    const { server, subject, chat } = setup();
    const generation = server.begin(chat.id, 'Frage vom iPad');
    generation.delta('Das läuft schon');
    open(server, chatPath(subject.id, chat.id));

    expect(await screen.findByText('Frage vom iPad')).toBeTruthy();
    expect(await screen.findByText('Das läuft schon')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Antwort stoppen' })).toBeTruthy();
    await waitFor(() => expect(generation.listeners).toBe(1));

    act(() => {
      generation.delta(' weiter');
      generation.finish();
    });
    expect(await screen.findByText('Das läuft schon weiter')).toBeTruthy();
    await waitFor(() => expect(generation.listeners).toBe(0));
  });

  it('hängt sich wieder an, wenn die Seite nach dem Schlafen zurückkommt', async () => {
    const { server, subject, chat } = setup();
    const generation = server.begin(chat.id, 'Frage');
    generation.delta('Anfang');
    open(server, chatPath(subject.id, chat.id));
    await screen.findByText('Anfang');
    await waitFor(() =>
      expect(server.calls('GET', `/api/chats/${chat.id}/generation`)).toHaveLength(1),
    );

    act(() => generation.delta(' Mitte'));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() =>
      expect(server.calls('GET', `/api/chats/${chat.id}/generation`)).toHaveLength(2),
    );
    expect(await screen.findByText('Anfang Mitte')).toBeTruthy();
    // Der alte Strom wurde beendet, es hört genau einer zu.
    await waitFor(() => expect(generation.listeners).toBe(1));
  });

  it('lässt den Entwurf stehen und nennt den Grund, wenn der Server die Nachricht ablehnt', async () => {
    const { server, subject, chat } = setup();
    server.replyOnce('POST', `/api/chats/${chat.id}/messages`, () => json(409, { error: 'busy' }));
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await ask(user, 'Meine Frage');

    expect(await screen.findByText('In diesem Chat läuft noch eine Antwort.')).toBeTruthy();
    expect((await composer()).value).toBe('Meine Frage');
    expect(screen.getByRole('button', { name: 'Senden' })).toBeTruthy();
  });

  it('meldet einen nicht erreichbaren Server, lädt neu und behält den Entwurf', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await composer();
    await user.click(await composer());
    await user.paste('Frage ohne Netz');
    server.replyOnce('POST', `/api/chats/${chat.id}/messages`, () => {
      throw new TypeError('Failed to fetch');
    });
    await user.click(screen.getByRole('button', { name: 'Senden' }));

    expect(await screen.findByText(/Der Server antwortet nicht/)).toBeTruthy();
    expect((await composer()).value).toBe('Frage ohne Netz');
    expect(screen.getByRole('button', { name: 'Erneut verbinden' })).toBeTruthy();
  });
});

describe('Chat: Eingabe', () => {
  it('sendet mit Strg + Enter und macht mit Enter eine neue Zeile', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    const field = await composer();
    await user.click(field);
    await user.paste('Zeile eins');
    await user.keyboard('{Enter}');
    await user.paste('Zeile zwei');
    expect(field.value).toBe('Zeile eins\nZeile zwei');
    expect(server.calls('POST', `/api/chats/${chat.id}/messages`)).toHaveLength(0);

    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    expect(server.calls('POST', `/api/chats/${chat.id}/messages`)[0]?.body).toEqual({
      content: 'Zeile eins\nZeile zwei',
    });
  });

  it('sendet mit Enter, wenn eine Maus oder ein Trackpad vorhanden ist', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) => ({ matches: query === '(pointer: fine)', media: query }) as MediaQueryList,
    );
    try {
      const { server, subject, chat } = setup();
      open(server, chatPath(subject.id, chat.id));
      const user = userEvent.setup();
      await user.click(await composer());
      await user.paste('Per Enter');
      await user.keyboard('{Enter}');
      await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
      // Mit Umschalt bleibt es eine neue Zeile.
      expect(screen.getByText(/Enter sendet/)).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sendet keine leere oder zu lange Nachricht', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    const send = await screen.findByRole('button', { name: 'Senden' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    await user.click(await composer());
    await user.paste('   ');
    expect((send as HTMLButtonElement).disabled).toBe(true);

    await user.clear(await composer());
    await user.paste('x'.repeat(50_001));
    await user.click(send);
    expect(await screen.findByText(/höchstens 50\.000 Zeichen/)).toBeTruthy();
    expect(server.calls('POST', `/api/chats/${chat.id}/messages`)).toHaveLength(0);
  });

  it('behält den Entwurf, wenn man den Chat verlässt und wiederkommt', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await user.click(await composer());
    await user.paste('Noch nicht fertig');
    await user.click(
      within(screen.getByRole('main')).getByRole('link', { name: 'Beispielfach A' }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Beispielfach A' });
    await user.click(await screen.findByRole('link', { name: /Neuer Chat/ }));
    expect((await composer()).value).toBe('Noch nicht fertig');
  });
});

describe('Chat: ohne Modell', () => {
  it('sperrt das Eingabefeld und verweist auf die Einstellungen', async () => {
    const { server, subject, chat } = setup({ model: false });
    open(server, chatPath(subject.id, chat.id));
    expect(await screen.findByText('Noch kein Modell gewählt')).toBeTruthy();
    expect((await composer()).disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'Zu den Einstellungen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Modell wählen' }).textContent).toContain(
      'Kein Modell',
    );
  });
});

describe('Chat: Modell, Titel, Löschen', () => {
  it('zeigt das geltende Modell und lässt es für den Chat ändern', async () => {
    const { server, subject, chat, provider } = setup();
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    const chip = await screen.findByRole('button', { name: 'Modell wählen' });
    expect(chip.textContent).toContain('Anbieter A · modell-a');

    await user.click(chip);
    const dialog = await screen.findByRole('dialog', { name: 'Modell für diesen Chat' });
    const select = within(dialog).getByLabelText('Modell') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(
      within(dialog).getByRole('option', { name: 'Wie im Fach (Anbieter A · modell-a)' }),
    ).toBeTruthy();
    await user.selectOptions(select, `${provider.id}|modell-b`);
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.calls('PATCH', `/api/chats/${chat.id}`)[0]?.body).toEqual({
      model: { providerId: provider.id, model: 'modell-b' },
    });
    expect(screen.getByRole('button', { name: 'Modell wählen' }).textContent).toContain(
      'Anbieter A · modell-b',
    );
  });

  it('benennt den Chat um', async () => {
    const { server, subject, chat } = setup();
    server.addMessage(chat.id, 'user', 'Alte Frage');
    chat.title = 'Alter Titel';
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Chat umbenennen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chat umbenennen' });
    const field = within(dialog).getByLabelText('Titel') as HTMLInputElement;
    expect(field.value).toBe('Alter Titel');
    await user.clear(field);
    await user.type(field, 'Neuer Titel');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Neuer Titel' })).toBeTruthy();
    expect(server.calls('PATCH', `/api/chats/${chat.id}`)[0]?.body).toEqual({
      title: 'Neuer Titel',
    });
  });

  it('löscht den Chat nach Rückfrage und kehrt zum Fach zurück', async () => {
    const { server, subject, chat } = setup();
    chat.title = 'Zu löschen';
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Chat löschen' }));
    const dialog = await screen.findByRole('dialog', { name: /Chat „Zu löschen“ löschen\?/ });
    await user.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/subjects/${subject.id}`));
    expect(server.chats).toHaveLength(0);
    expect(await screen.findByText('Noch keine Chats')).toBeTruthy();
  });

  it('zeigt „nicht gefunden“ für einen Chat, den es nicht gibt oder der zu einem anderen Fach gehört', async () => {
    const { server, subject } = setup();
    const other = server.addSubject('Beispielfach B');
    const foreign = server.addChat(other.id);
    open(server, chatPath(subject.id, 'gibt-es-nicht'));
    expect(await screen.findByText('Diese Seite gibt es nicht')).toBeTruthy();
    window.history.replaceState(null, '', chatPath(subject.id, foreign.id));
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByText('Diese Seite gibt es nicht')).toBeTruthy();
  });
});

describe('Chat: sichere Darstellung', () => {
  const hostile = [
    'Normaler Text mit [Link](https://beispiel.test/seite).',
    '<script>window.__angriff = 1</script>',
    '<img src="x" onerror="window.__angriff = 2">',
    '![Bild](https://beispiel.test/pixel.png)',
    '[Böse](javascript:window.__angriff=3)',
    '<a href="javascript:window.__angriff=4">roh</a>',
    '```js\nconst a = "<b>kein HTML</b>";\n```',
  ].join('\n\n');

  it('führt nichts aus und lädt keine Bilder', async () => {
    const { server, subject, chat } = setup();
    server.addMessage(chat.id, 'user', 'Frage');
    server.addMessage(chat.id, 'assistant', hostile, { model: 'modell-a' });
    open(server, chatPath(subject.id, chat.id));

    await screen.findByText(/Normaler Text/);
    const article = screen.getAllByRole('article')[1] as HTMLElement;
    expect(article.querySelector('script')).toBeNull();
    expect(article.querySelector('img')).toBeNull();
    expect(article.querySelector('[onerror]')).toBeNull();
    expect(article.textContent).toContain('Bild ausgelassen: Bild');
    expect(article.textContent).toContain('<script>');
    expect((window as unknown as { __angriff?: number }).__angriff).toBeUndefined();

    const good = within(article).getByRole('link', { name: 'Link' });
    expect(good.getAttribute('href')).toBe('https://beispiel.test/seite');
    expect(good.getAttribute('target')).toBe('_blank');
    expect(good.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    for (const link of article.querySelectorAll('a')) {
      expect(link.getAttribute('href') ?? '').toMatch(/^https:/);
    }
    // Der unsichere Link bleibt als Text sichtbar, ist aber kein Link mehr.
    expect(within(article).getByText('Böse').closest('a')).toBeNull();
    expect(article.querySelector('pre code')?.textContent).toContain('<b>kein HTML</b>');
  });

  it('stellt Tabellen, Listen und Zitate dar', async () => {
    const { server, subject, chat } = setup();
    server.addMessage(chat.id, 'user', 'Frage');
    server.addMessage(
      chat.id,
      'assistant',
      ['| a | b |', '|---|---|', '| 1 | 2 |', '', '- eins', '- zwei', '', '> Zitat'].join('\n'),
    );
    open(server, chatPath(subject.id, chat.id));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(within(screen.getByRole('main')).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Zitat').closest('blockquote')).toBeTruthy();
  });

  it('kopiert Antwort und Code', async () => {
    const { server, subject, chat } = setup();
    server.addMessage(chat.id, 'user', 'Frage');
    server.addMessage(chat.id, 'assistant', 'Text\n\n```\nprint(1)\n```');
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Code kopieren' }));
    expect(await navigator.clipboard.readText()).toBe('print(1)');
    await user.click(screen.getByRole('button', { name: 'Antwort kopieren' }));
    expect(await navigator.clipboard.readText()).toBe('Text\n\n```\nprint(1)\n```');
  });
});

describe('Chatliste im Fach', () => {
  it('zeigt die Chats des Fachs, aber nicht die der Untergruppen', async () => {
    const { server, subject, chat } = setup();
    server.subjects[0]?.groups.push({ id: 'g1', name: 'Gruppe X', kind: null, position: 0 });
    chat.title = 'Chat im Fach';
    server.addChat(subject.id, { title: 'Chat in der Gruppe', groupId: 'g1' });
    open(server, `/subjects/${subject.id}`);
    expect(await screen.findByRole('link', { name: /Chat im Fach/ })).toBeTruthy();
    expect(screen.queryByText('Chat in der Gruppe')).toBeNull();

    window.history.pushState(null, '', `/subjects/${subject.id}/groups/g1`);
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByRole('link', { name: /Chat in der Gruppe/ })).toBeTruthy();
    expect(screen.queryByText('Chat im Fach')).toBeNull();
  });

  it('legt einen neuen Chat an und öffnet ihn; der leere Chat wird danach wiederverwendet', async () => {
    const { server, subject, chat } = setup();
    server.chats = [];
    open(server, `/subjects/${subject.id}`);
    const user = userEvent.setup();
    expect(await screen.findByText('Noch keine Chats')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Neuer Chat' }));
    await waitFor(() => expect(window.location.pathname).toMatch(/\/chats\//));
    expect(server.chats).toHaveLength(1);
    expect(server.calls('POST', '/api/chats')[0]?.body).toEqual({
      subjectId: subject.id,
      groupId: null,
    });
    expect(await composer()).toBeTruthy();

    // Zurück ins Fach: der leere Chat steht in der Liste, ein zweiter „Neuer Chat“ öffnet ihn nur.
    await user.click(
      within(screen.getByRole('main')).getByRole('link', { name: 'Beispielfach A' }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Beispielfach A' });
    await screen.findByRole('link', { name: /Neuer Chat/ });
    await user.click(screen.getByRole('button', { name: 'Neuer Chat' }));
    await waitFor(() => expect(window.location.pathname).toMatch(/\/chats\//));
    expect(server.chats).toHaveLength(1);
    expect(chat.id).toBeDefined();
  });

  it('löscht einen Chat nach Rückfrage', async () => {
    const { server, subject, chat } = setup();
    chat.title = 'Alter Chat';
    open(server, `/subjects/${subject.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Chat „Alter Chat“ löschen' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: /Alter Chat/ })).toBeNull());
    expect(server.chats).toHaveLength(0);
  });

  it('zeigt, dass im Chat gerade eine Antwort läuft', async () => {
    const { server, subject, chat } = setup();
    chat.title = 'Läuft';
    server.begin(chat.id, 'Frage');
    open(server, `/subjects/${subject.id}`);
    expect(await screen.findByText('Antwort läuft')).toBeTruthy();
  });

  it('ändert das Modell des Fachs', async () => {
    const { server, subject, provider } = setup();
    open(server, `/subjects/${subject.id}`);
    const user = userEvent.setup();
    expect(await screen.findByText('Standardmodell: Anbieter A · modell-a')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Modell ändern' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modell für dieses Fach' });
    await user.selectOptions(within(dialog).getByLabelText('Modell'), `${provider.id}|modell-b`);
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Eigenes Modell: Anbieter A · modell-b')).toBeTruthy();
    expect(server.calls('PUT', `/api/subjects/${subject.id}/model`)[0]?.body).toEqual({
      model: { providerId: provider.id, model: 'modell-b' },
    });
  });

  it('gilt das Modell des Fachs im Chat, solange der Chat keines gewählt hat', async () => {
    const { server, subject, chat, provider } = setup();
    subject.model = { providerId: provider.id, model: 'modell-b' };
    open(server, chatPath(subject.id, chat.id));
    const chip = await screen.findByRole('button', { name: 'Modell wählen' });
    expect(chip.textContent).toContain('Anbieter A · modell-b');
    expect(chip.textContent).toContain('vom Fach');
  });
});
