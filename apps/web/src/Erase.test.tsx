// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer, TEST_PASSCODE } from './test/fake-server';

function mount(server: FakeServer) {
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Alles löschen …' }));
  return screen.findByRole('dialog', { name: 'Wirklich alles löschen?' });
}

describe('Alles löschen', () => {
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.history.replaceState(null, '', '/settings');
    assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
  });
  afterEach(() => vi.unstubAllGlobals());

  function seeded() {
    const server = new FakeServer('unlocked');
    server.addSubject('Beispielfach A');
    server.addProvider('Beispiel-Anbieter');
    return server;
  }

  it('steht in den Einstellungen und erklärt, was gelöscht wird und was bleibt', async () => {
    mount(seeded());
    const section = (await screen.findByRole('heading', { name: 'Deine Daten' })).closest(
      'section',
    ) as HTMLElement;
    expect(section.textContent).toContain('Chats');
    expect(section.textContent).toContain('Sicherungen');
    expect(section.textContent).toContain('Dein Passcode bleibt');
    expect(section.textContent).toContain('nicht rückgängig');
  });

  it('löscht nichts, solange man abbricht oder schließt', async () => {
    const server = seeded();
    mount(server);
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await openDialog(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(server.calls('POST', '/api/data/erase')).toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
  });

  it('verlangt den Passcode und bleibt bei einem falschen offen', async () => {
    const server = seeded();
    mount(server);
    const user = userEvent.setup();
    const dialog = await openDialog(user);

    // Ohne Eingabe wird nichts gesendet.
    await user.click(within(dialog).getByRole('button', { name: 'Alles endgültig löschen' }));
    expect(server.calls('POST', '/api/data/erase')).toHaveLength(0);
    expect(within(dialog).getByText('Der Passcode stimmt nicht.')).toBeTruthy();

    await user.type(within(dialog).getByLabelText('Passcode'), 'falscher Passcode');
    await user.click(within(dialog).getByRole('button', { name: 'Alles endgültig löschen' }));
    await waitFor(() => expect(server.calls('POST', '/api/data/erase')).toHaveLength(1));
    expect(await within(dialog).findByText('Der Passcode stimmt nicht.')).toBeTruthy();
    expect(server.erased).toBe(0);
    expect(server.subjects).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('löscht mit dem Passcode alles und lädt die App neu', async () => {
    const server = seeded();
    server.profile = { ...server.profile, onboardingCompleted: true, gradeLevel: '11' };
    mount(server);
    const user = userEvent.setup();
    const dialog = await openDialog(user);

    await user.type(within(dialog).getByLabelText('Passcode'), TEST_PASSCODE);
    await user.click(within(dialog).getByRole('button', { name: 'Alles endgültig löschen' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(server.erased).toBe(1);
    expect(server.subjects).toEqual([]);
    expect(server.providers).toEqual([]);
    expect(server.profile.onboardingCompleted).toBe(false);
    // Der Passcode geht nur im Körper dieser einen Anfrage mit.
    expect(server.calls('POST', '/api/data/erase')[0]?.body).toEqual({ passcode: TEST_PASSCODE });
  });

  it('zeigt Fehler verständlich und bleibt offen', async () => {
    const server = seeded();
    const original = server.fetch;
    server.fetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      if (String(input).endsWith('/api/data/erase')) {
        return new Response(JSON.stringify({ error: 'erase_failed' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return original(input, init);
    }) as typeof fetch;
    mount(server);
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText('Passcode'), TEST_PASSCODE);
    await user.click(within(dialog).getByRole('button', { name: 'Alles endgültig löschen' }));
    expect(await within(dialog).findByText(/nicht vollständig geklappt/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });
});
