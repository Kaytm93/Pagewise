// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer, json } from './test/fake-server';

function mount(server: FakeServer) {
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

// Nachgeladene Teile (Auswahl der Vorlagen, Prompt-Dialog) einmal vorab laden, damit langsame Rechner
// die Wartezeit einzelner Tests nicht überschreiten.
beforeAll(async () => {
  await import('./screens/prompts/PromptDialog');
}, 30_000);

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

// Der Dialog hat zwei Schaltflächen „Schließen“: das X in der Kopfzeile und die in der Fußzeile.
function closeButton(dialog: HTMLElement): HTMLElement {
  const buttons = within(dialog).getAllByRole('button', { name: 'Schließen' });
  const footer = buttons.at(-1);
  if (!footer) throw new Error('Keine Schaltfläche „Schließen“ gefunden');
  return footer;
}

/** Ein Server ohne mitgelieferte Standardtexte: Hier geht es um eigene Texte und leere Ebenen. */
function subjectServer() {
  const server = new FakeServer('unlocked');
  server.defaultPrompts = {};
  const subject = server.addSubject('Beispielfach A');
  const group = { id: 'gruppe-1', name: 'Beispiel-Thema', kind: null, position: 0 };
  subject.groups.push(group);
  return { server, subject, group };
}

describe('Prompts je Ebene', () => {
  it('startet ohne Text und füllt nichts vor', async () => {
    const { server, subject } = subjectServer();
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();

    expect(await screen.findByText('Noch nichts festgelegt')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Fach-Prompt: Festlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fach-Prompt' });
    expect((within(dialog).getByLabelText('Text') as HTMLTextAreaElement).value).toBe('');
    expect(within(dialog).getByText('0 von 20000 Zeichen')).toBeTruthy();
    expect(within(dialog).getByText('{{fach}}')).toBeTruthy();
  });

  it('speichert den Fach-Prompt und zeigt danach seinen Stand', async () => {
    const { server, subject } = subjectServer();
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Fach-Prompt: Festlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fach-Prompt' });
    const save = within(dialog).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    // „{“ ist bei user.type ein Sonderzeichen, deshalb wird der Text eingefügt.
    await user.click(within(dialog).getByLabelText('Text'));
    await user.paste('Du hilfst bei {{fach}}.');
    expect(within(dialog).getByText('Ungespeicherte Änderungen')).toBeTruthy();
    await user.click(save);

    expect(await within(dialog).findByText('Gespeichert.')).toBeTruthy();
    expect(server.prompts.get(`subject:${subject.id}`)).toBe('Du hilfst bei {{fach}}.');
    await user.click(closeButton(dialog));
    expect(await screen.findByText('Festgelegt, 23 Zeichen')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fach-Prompt: Bearbeiten' })).toBeTruthy();
  });

  it('zeigt in der Vorschau die Ebenen und fehlende Platzhalter', async () => {
    const { server, subject } = subjectServer();
    server.prompts.set('general', 'Allgemeiner Text');
    server.prompts.set(`subject:${subject.id}`, 'Text für {{bundesland}}');
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Fach-Prompt: Bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fach-Prompt' });
    await user.click(within(dialog).getByLabelText('Vorschau'));

    expect(await within(dialog).findByText('Technische Ebene')).toBeTruthy();
    expect(within(dialog).getByText('Allgemeiner Prompt')).toBeTruthy();
    expect(within(dialog).getByText('Allgemeiner Text')).toBeTruthy();
    expect(within(dialog).getByText('Text für {{bundesland}}')).toBeTruthy();
    expect(
      within(dialog).getByText(/Dafür ist nichts hinterlegt: \{\{bundesland\}\}/),
    ).toBeTruthy();
    // Im Vorschau-Reiter gibt es nichts zu speichern.
    expect(within(dialog).queryByRole('button', { name: 'Speichern' })).toBeNull();

    await user.click(within(dialog).getByLabelText('Bearbeiten'));
    expect(within(dialog).getByLabelText('Text')).toBeTruthy();
  });

  it('weist darauf hin, wenn bisher nur die technische Ebene gilt', async () => {
    const { server, subject } = subjectServer();
    server.prompts.set(`subject:${subject.id}`, null);
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Fach-Prompt: Festlegen' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByLabelText('Vorschau'));
    expect(await within(dialog).findByText(/Bisher gilt nur die technische Ebene/)).toBeTruthy();
  });

  it('speichert den Zusatz einer Untergruppe auf deren Seite', async () => {
    const { server, subject, group } = subjectServer();
    window.history.replaceState(null, '', `/subjects/${subject.id}/groups/${group.id}`);
    mount(server);
    const user = userEvent.setup();

    expect(await screen.findByText('Kommt nur in dieser Untergruppe hinzu.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Zusatz der Untergruppe: Festlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zusatz der Untergruppe' });
    await user.type(within(dialog).getByLabelText('Text'), 'Nur dieses Thema');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await within(dialog).findByText('Gespeichert.');
    expect(server.prompts.get(`group:${group.id}`)).toBe('Nur dieses Thema');
    expect(server.prompts.has(`subject:${subject.id}`)).toBe(false);
  });

  it('leert einen Prompt mit „Leeren“ und Speichern', async () => {
    const { server, subject } = subjectServer();
    server.prompts.set(`subject:${subject.id}`, 'alter Text');
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Fach-Prompt: Bearbeiten' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Text') as HTMLTextAreaElement).value).toBe('alter Text');
    await user.click(within(dialog).getByRole('button', { name: 'Leeren' }));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await within(dialog).findByText('Gespeichert.');
    expect(server.prompts.get(`subject:${subject.id}`)).toBeNull();
    await user.click(closeButton(dialog));
    expect(await screen.findByText('Noch nichts festgelegt')).toBeTruthy();
  });

  it('verwirft ungespeicherte Änderungen beim Schließen', async () => {
    const { server, subject } = subjectServer();
    server.prompts.set(`subject:${subject.id}`, 'gespeichert');
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Fach-Prompt: Bearbeiten' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Text'), ' und mehr');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.calls('PUT', `/api/prompts/subjects/${subject.id}`)).toHaveLength(0);
    expect(server.prompts.get(`subject:${subject.id}`)).toBe('gespeichert');
  });

  it('sperrt das Speichern bei zu langem Text', async () => {
    const { server, subject } = subjectServer();
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Fach-Prompt: Festlegen' }));
    const dialog = await screen.findByRole('dialog');
    const area = within(dialog).getByLabelText('Text');
    await user.click(area);
    await user.paste('x'.repeat(20_001));
    expect(
      within(dialog).getByText('Der Text ist zu lang (höchstens 20000 Zeichen).'),
    ).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('zeigt Fehler des Servers beim Speichern', async () => {
    const { server, subject } = subjectServer();
    server.replyOnce('PUT', `/api/prompts/subjects/${subject.id}`, () =>
      json(400, { error: 'invalid_input', field: 'text' }),
    );
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Fach-Prompt: Festlegen' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Text'), 'Text');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText('Der Text enthält ungültige Zeichen.')).toBeTruthy();
    expect(within(dialog).queryByText('Gespeichert.')).toBeNull();
  });

  it('bearbeitet den allgemeinen Prompt in den Einstellungen, ohne Vorschau', async () => {
    const server = new FakeServer('unlocked');
    window.history.replaceState(null, '', '/settings');
    mount(server);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Allgemeiner Prompt: Festlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Allgemeiner Prompt' });
    expect(within(dialog).queryByLabelText('Vorschau')).toBeNull();
    await user.type(within(dialog).getByLabelText('Text'), 'Für alle Fächer');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await within(dialog).findByText('Gespeichert.');
    expect(server.prompts.get('general')).toBe('Für alle Fächer');
  });

  it('meldet, wenn der Prompt nicht geladen werden kann', async () => {
    const { server, subject } = subjectServer();
    server.replyOnce('GET', `/api/prompts/subjects/${subject.id}`, () =>
      json(500, { error: 'internal' }),
    );
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    expect(await screen.findByText('Der Prompt konnte nicht geladen werden.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /Fach-Prompt/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

/** Ein Fach aus der Vorlage „beispiel-a“: Hier gilt ein mitgelieferter Standardtext (D-034). */
function defaultServer() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A', { templateKey: 'beispiel-a' });
  return { server, subject };
}

describe('Standard-Prompt je Fach', () => {
  it('zeigt „Standard aktiv“ und den Standardtext lesbar, ohne etwas zu speichern', async () => {
    const { server, subject } = defaultServer();
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();

    expect(await screen.findByText('Standard aktiv')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Fach-Prompt: Ansehen oder ändern' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fach-Prompt' });

    expect(within(dialog).getByText('Es gilt der Standardtext.')).toBeTruthy();
    expect(
      within(dialog).getByText(/Der Standard ist für alle Pagewise-Nutzer gleich/),
    ).toBeTruthy();
    expect(within(dialog).getByText('Standardtext A für {{fach}}')).toBeTruthy();
    // Gelesen wird nur, bearbeitet wird erst nach „Bearbeiten“.
    expect(within(dialog).queryByLabelText('Text')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Auf Standard zurücksetzen' })).toBeNull();
    expect(server.calls('PUT', `/api/prompts/subjects/${subject.id}`)).toHaveLength(0);
  });

  it('kopiert beim Bearbeiten den Standardtext ins Eingabefeld, speichert aber nur Änderungen', async () => {
    const { server, subject } = defaultServer();
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Fach-Prompt: Ansehen oder ändern' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Fach-Prompt' });

    await user.click(within(dialog).getByRole('button', { name: 'Bearbeiten' }));
    const area = within(dialog).getByLabelText('Text') as HTMLTextAreaElement;
    expect(area.value).toBe('Standardtext A für {{fach}}');
    const save = within(dialog).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement;
    // Unverändert gibt es nichts zu speichern: Der Standard bleibt der Standard.
    expect(save.disabled).toBe(true);

    await user.click(area);
    await user.paste(' und mehr');
    expect(save.disabled).toBe(false);
    await user.click(save);

    expect(await within(dialog).findByText('Gespeichert.')).toBeTruthy();
    expect(server.prompts.get(`subject:${subject.id}`)).toBe(
      'Standardtext A für {{fach}} und mehr',
    );
    expect(within(dialog).getByText('Es gilt dein eigener Text.')).toBeTruthy();
    await user.click(closeButton(dialog));
    expect(await screen.findByText(/Eigener Text, 36 Zeichen/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fach-Prompt: Bearbeiten' })).toBeTruthy();
  });

  it('setzt mit Bestätigung auf den Standard zurück', async () => {
    const { server, subject } = defaultServer();
    server.prompts.set(`subject:${subject.id}`, 'Mein eigener Text');
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Fach-Prompt: Bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fach-Prompt' });
    expect((within(dialog).getByLabelText('Text') as HTMLTextAreaElement).value).toBe(
      'Mein eigener Text',
    );
    expect(within(dialog).getByText('Es gilt dein eigener Text.')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Auf Standard zurücksetzen' }));
    const confirm = await screen.findByRole('dialog', { name: 'Auf den Standard zurücksetzen?' });
    // Abbrechen lässt alles, wie es war.
    await user.click(within(confirm).getByRole('button', { name: 'Abbrechen' }));
    expect(server.prompts.get(`subject:${subject.id}`)).toBe('Mein eigener Text');

    await user.click(within(dialog).getByRole('button', { name: 'Auf Standard zurücksetzen' }));
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'Auf den Standard zurücksetzen?' }),
      ).getByRole('button', { name: 'Zurücksetzen' }),
    );

    await waitFor(() => expect(server.prompts.get(`subject:${subject.id}`)).toBeNull());
    expect(await within(dialog).findByText('Es gilt der Standardtext.')).toBeTruthy();
    expect(within(dialog).getByText('Standardtext A für {{fach}}')).toBeTruthy();
    await user.click(closeButton(dialog));
    expect(await screen.findByText('Standard aktiv')).toBeTruthy();
  });

  it('behandelt einen Text, der dem Standard gleicht, weiter als Standard', async () => {
    const { server, subject } = defaultServer();
    server.prompts.set(`subject:${subject.id}`, 'alt');
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Fach-Prompt: Bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fach-Prompt' });
    const area = within(dialog).getByLabelText('Text');
    await user.clear(area);
    await user.click(area);
    await user.paste('Standardtext A für {{fach}}');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await within(dialog).findByText('Gespeichert.');
    expect(server.prompts.get(`subject:${subject.id}`)).toBeNull();
    expect(await within(dialog).findByText('Es gilt der Standardtext.')).toBeTruthy();
  });

  it('nennt in der Vorschau den Standardtext mit eingesetztem Fachnamen und seiner Herkunft', async () => {
    const { server, subject } = defaultServer();
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Fach-Prompt: Ansehen oder ändern' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Fach-Prompt' });
    await user.click(within(dialog).getByLabelText('Vorschau'));
    expect(await within(dialog).findByText('Fach-Prompt (Standard)')).toBeTruthy();
    expect(within(dialog).getByText('Standardtext A für Beispielfach A')).toBeTruthy();
    expect(within(dialog).queryByText(/Bisher gilt nur die technische Ebene/)).toBeNull();
  });

  it('fällt für ein selbst angelegtes Fach auf den allgemeinen Standardtext zurück', async () => {
    const server = new FakeServer('unlocked');
    const subject = server.addSubject('Ganz Eigenes Fach');
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Fach-Prompt: Ansehen oder ändern' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Fach-Prompt' });
    expect(within(dialog).getByText('Allgemeiner Standardtext für {{fach}}')).toBeTruthy();
  });

  it('gilt auch für das eingebaute Fach „Standard“ mit eigenem Text', async () => {
    const server = new FakeServer('unlocked');
    window.history.replaceState(null, '', `/subjects/${server.defaultSubject.id}`);
    mount(server);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Fach-Prompt: Ansehen oder ändern' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Fach-Prompt' });
    expect(within(dialog).getByText('Standardtext fachlos')).toBeTruthy();
  });

  it('lässt Allgemeinen Prompt und Untergruppen-Zusatz ohne Standard (nur Fach-Prompts haben einen)', async () => {
    const server = new FakeServer('unlocked');
    window.history.replaceState(null, '', '/settings');
    mount(server);
    expect(
      await screen.findByRole('button', { name: 'Allgemeiner Prompt: Festlegen' }),
    ).toBeTruthy();
    expect(screen.queryByText('Standard aktiv')).toBeNull();
  });
});
