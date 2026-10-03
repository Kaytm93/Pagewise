// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer, json } from './test/fake-server';

function mount(server: FakeServer) {
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

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

function subjectServer() {
  const server = new FakeServer('unlocked');
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
