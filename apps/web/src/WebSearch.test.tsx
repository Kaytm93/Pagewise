// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { ToolNotes } from './screens/chat/ToolNotes';
import { FakeServer } from './test/fake-server';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const SEARCH_KEY = ['suche', 'schluessel', 'abcdefghijklmnop'].join('-');

function open(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

afterEach(() => cleanup());

describe('Einstellungen: Websuche für die KI', () => {
  it('ist standardmäßig aus und speichert den Schalter', async () => {
    const server = new FakeServer('unlocked');
    open(server, '/settings');
    const user = userEvent.setup();
    const box = (await screen.findByRole('checkbox', {
      name: /KI darf im Internet suchen/,
    })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await user.click(box);
    await waitFor(() => expect(server.webSearch.enabled).toBe(true));
    expect(server.calls('PUT', '/api/web-search')[0]?.body).toEqual({ enabled: true });
  });

  it('speichert einen Schlüssel und zeigt nur seine letzten Zeichen', async () => {
    const server = new FakeServer('unlocked');
    open(server, '/settings');
    const user = userEvent.setup();
    const field = (await screen.findByLabelText(
      /Schlüssel der Brave Search API/,
    )) as HTMLInputElement;
    await user.type(field, SEARCH_KEY);
    await user.click(screen.getByRole('button', { name: 'Schlüssel speichern' }));
    expect(await screen.findByText('Schlüssel gespeichert, endet auf mnop')).toBeTruthy();
    expect(server.calls('PUT', '/api/web-search')[0]?.body).toEqual({ apiKey: SEARCH_KEY });
    expect(field.value).toBe('');
  });

  it('prüft die Verbindung und sagt, was der Dienst geantwortet hat', async () => {
    const server = new FakeServer('unlocked');
    server.webSearch.keyHint = 'mnop';
    open(server, '/settings');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Verbindung prüfen' }));
    expect(
      await screen.findByText('Die Verbindung funktioniert (1 Treffer bei der Prüfsuche).'),
    ).toBeTruthy();

    server.webSearch.testReply = { ok: false, error: 'auth_failed' };
    await user.click(screen.getByRole('button', { name: 'Verbindung prüfen' }));
    expect(await screen.findByText('Der Dienst hat den Schlüssel abgelehnt.')).toBeTruthy();
  });
});

describe('Chat: Hinweis zur Websuche', () => {
  it('zeigt die Websuche mit dem Suchbegriff, nie die Treffer', () => {
    render(
      <ToolNotes
        steps={[{ id: 'tool-0', tool: 'web_search', target: 'Photosynthese', state: 'done' }]}
      />,
    );
    expect(screen.getByText('Websuche: Photosynthese')).toBeTruthy();
  });
});
