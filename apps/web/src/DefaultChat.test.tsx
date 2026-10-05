// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer, json } from './test/fake-server';

function mount(server: FakeServer, path = '/') {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

const nav = () => screen.getByRole('navigation', { name: 'Navigation' });

// Die Chatansicht wird beim ersten Öffnen nachgeladen (siehe Chat.test.tsx).
beforeAll(async () => {
  await import('./screens/chat/ChatPage');
}, 30_000);

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Standard-Chat über den Namen „Pagewise“', () => {
  it('öffnet bei einer leeren Installation einen Chat im Fach „Standard“, ganz ohne Schulfach', async () => {
    const server = new FakeServer('unlocked');
    expect(server.subjects).toHaveLength(0);
    mount(server);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('link', { name: 'Pagewise – Standard-Chat öffnen' }));

    await waitFor(() =>
      expect(window.location.pathname).toMatch(/^\/subjects\/[^/]+\/chats\/[^/]+$/),
    );
    expect(server.calls('POST', '/api/chats')[0]?.body).toEqual({
      subjectId: server.defaultSubject.id,
      groupId: null,
    });
    expect(window.location.pathname).toBe(
      `/subjects/${server.defaultSubject.id}/chats/${server.chats[0]?.id}`,
    );
    // Der Chat gehört zum Fach „Standard“ und zu keinem Schulfach.
    expect(server.chats).toHaveLength(1);
    expect(server.chats[0]?.subjectId).toBe(server.defaultSubject.id);
    expect(await screen.findByRole('textbox', { name: 'Nachricht' })).toBeTruthy();
    expect(document.title).toBe('Standard · Pagewise');
  });

  it('benutzt einen noch leeren Chat wieder, statt einen zweiten anzulegen', async () => {
    const server = new FakeServer('unlocked');
    const empty = server.addChat(server.defaultSubject.id);
    mount(server);
    await userEvent
      .setup()
      .click(await screen.findByRole('link', { name: 'Pagewise – Standard-Chat öffnen' }));
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        `/subjects/${server.defaultSubject.id}/chats/${empty.id}`,
      ),
    );
    expect(server.calls('POST', '/api/chats')).toHaveLength(0);
  });

  it('legt einen neuen Chat an, wenn alle bisherigen schon einen Titel haben', async () => {
    const server = new FakeServer('unlocked');
    const used = server.addChat(server.defaultSubject.id, { title: 'Früherer Chat' });
    mount(server);
    await userEvent
      .setup()
      .click(await screen.findByRole('link', { name: 'Pagewise – Standard-Chat öffnen' }));
    await waitFor(() => expect(server.calls('POST', '/api/chats')).toHaveLength(1));
    await waitFor(() => expect(window.location.pathname).toMatch(/\/chats\/.+/));
    expect(window.location.pathname).not.toContain(used.id);
  });

  it('erreicht man auch über die Adresse /chat und ersetzt sie im Verlauf (Zurück führt nicht im Kreis)', async () => {
    const server = new FakeServer('unlocked');
    mount(server, '/chat');
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/subjects\/[^/]+\/chats\//));
    expect(server.calls('POST', '/api/chats')).toHaveLength(1);
  });

  it('meldet einen Fehler mit „Erneut versuchen“ und klappt danach', async () => {
    const server = new FakeServer('unlocked');
    server.replyOnce('POST', '/api/chats', () => json(500, { error: 'internal' }));
    mount(server, '/chat');
    const user = userEvent.setup();
    expect(await screen.findByText('Der Standard-Chat konnte nicht geöffnet werden.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/subjects\/[^/]+\/chats\//));
  });

  it('legt im Entwicklungsmodus (Effekte doppelt) nur einen Chat an', async () => {
    const server = new FakeServer('unlocked');
    mount(server, '/chat');
    await waitFor(() => expect(window.location.pathname).toMatch(/chats/));
    expect(server.chats).toHaveLength(1);
  });

  it('wird auch von der Startseite einer leeren Installation angeboten', async () => {
    const server = new FakeServer('unlocked');
    mount(server);
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Standard-Chat starten' }));
    await waitFor(() => expect(window.location.pathname).toMatch(/\/chats\//));
  });

  it('steht auf der Startseite mit Fächern als erster Eintrag', async () => {
    const server = new FakeServer('unlocked');
    server.addSubject('Beispielfach A');
    mount(server);
    await screen.findByRole('navigation', { name: 'Navigation' });
    // In der Liste der Fächer; darüber gibt es noch den Link „den Standard-Chat öffnen“.
    const list = within(await within(screen.getByRole('main')).findByRole('list'));
    const links = await list.findAllByRole('link', { name: /Standard-Chat|Beispielfach A/ });
    expect(links[0]?.textContent).toContain('Standard-Chat');
    expect(links[1]?.textContent).toContain('Beispielfach A');
  });
});

describe('Pagewise-Link: zugänglicher Name enthält den sichtbaren Text', () => {
  it('enthält den sichtbaren Namen „Pagewise“ im zugänglichen Namen', async () => {
    const server = new FakeServer('unlocked');
    mount(server);
    const link = await screen.findByRole('link', { name: 'Pagewise – Standard-Chat öffnen' });
    // Label-in-Name: der sichtbare Text „Pagewise“ steckt im zugänglichen Namen.
    expect(link.textContent).toContain('Pagewise');
  });
});

describe('Fach „Standard“ in der Oberfläche', () => {
  it('steht in der Seitenleiste, getrennt von den Fächern des Nutzers', async () => {
    const server = new FakeServer('unlocked');
    server.addSubject('Beispielfach A');
    mount(server);
    await screen.findByRole('navigation', { name: 'Navigation' });
    const links = within(nav()).getAllByRole('link');
    const names = links.map((link) => link.textContent);
    // Danach Stundenplan und Tests, dann die Fächer des Nutzers.
    expect(names.slice(0, 6)).toEqual([
      'Pagewise',
      'Start',
      'Standard',
      'Stundenplan',
      'Tests',
      'Beispielfach A',
    ]);
    expect(within(nav()).getByRole('link', { name: 'Standard' }).getAttribute('href')).toBe(
      `/subjects/${server.defaultSubject.id}`,
    );
  });

  it('hat eine Seite ohne „Bearbeiten“ und „Fach löschen“, aber mit Untergruppen, Prompt und Chats', async () => {
    const server = new FakeServer('unlocked');
    mount(server, `/subjects/${server.defaultSubject.id}`);
    expect(await screen.findByRole('heading', { name: 'Standard', level: 1 })).toBeTruthy();
    expect(
      screen.getByText(/Das eingebaute Fach für Fragen, die zu keinem Schulfach gehören/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Untergruppe hinzufügen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Fach-Prompt/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Neuer Chat' })).toBeTruthy();
  });

  it('nimmt Untergruppen auf wie jedes Fach', async () => {
    const server = new FakeServer('unlocked');
    mount(server, `/subjects/${server.defaultSubject.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Untergruppe hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Beispiel-Thema');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(server.defaultSubject.groups.map((g) => g.name)).toEqual(['Beispiel-Thema']),
    );
    expect(await within(nav()).findByRole('link', { name: 'Beispiel-Thema' })).toBeTruthy();
  });

  it('wird nach „Alles löschen“ wiederhergestellt, ohne die Chats darin', async () => {
    const server = new FakeServer('unlocked');
    server.addChat(server.defaultSubject.id, { title: 'Früherer Chat' });
    mount(server, `/subjects/${server.defaultSubject.id}`);
    expect(await screen.findByText('Früherer Chat')).toBeTruthy();
    // Der Server-Ersatz bildet „Alles löschen“ wie der echte Server nach: neues, leeres Standard-Fach.
    const before = server.defaultSubject.id;
    const response = await server.fetch('/api/data/erase', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'csrf-token-nur-fuer-tests' },
      body: JSON.stringify({ passcode: 'ein erfundener Beispiel-Passcode' }),
    });
    expect(response.status).toBe(204);
    expect(server.defaultSubject.id).not.toBe(before);
    expect(server.defaultSubject.name).toBe('Standard');
    expect(server.chats).toHaveLength(0);
  });
});
