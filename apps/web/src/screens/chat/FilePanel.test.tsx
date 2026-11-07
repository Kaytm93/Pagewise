// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../App';
import { ApiClient } from '../../api/client';
import type { ChatAsset, ChatFileEntry, ChatMessage } from '../../api/types';
import { SessionProvider } from '../../session/SessionProvider';
import { FakeServer, json } from '../../test/fake-server';
import { FilePanel } from './FilePanel';

/*
 * H-C02: Datei-Panel rechts im Chat (D-106). Die Liste zeigt Name, Größe und truncated-Hinweis,
 * Leer- und Fehlerzustand bleiben sauber; Downloads laufen nur über die bestehende Asset-Route
 * (Name+Größe aus dem Chat-Verlauf), nie über einen erfundenen Endpoint. Alle Namen sind erfunden.
 */

const files: ChatFileEntry[] = [
  { name: 'bericht.txt', size: 2048, extension: 'txt', mtimeMs: 1_000 },
  { name: 'tabelle.csv', size: 512, extension: 'csv', mtimeMs: 2_000 },
  { name: 'ohne-endung', size: 3, extension: '', mtimeMs: 3_000 },
];

// Ein vom Agenten erzeugter Asset-Datensatz: nur „bericht.txt“ ist über die Asset-Route ladbar.
const assets: ChatAsset[] = [
  { id: 'asset-1', name: 'bericht.txt', kind: 'text', mime: 'text/plain', size: 2048 },
];

function messageWithAssets(id: string): ChatMessage {
  return {
    id,
    seq: 1,
    role: 'assistant',
    content: '',
    status: 'complete',
    providerId: null,
    model: null,
    engineProfileId: null,
    errorCode: null,
    activity: [],
    assets,
    artifacts: [],
    codeRuns: [],
    reasoning: null,
    tokensPerSecond: null,
    costUsd: null,
    createdAt: 0,
  };
}

/** Server-Ersatz mit Chat (Standard-ID „chat-1“) und einstellbarer Dateiliste. */
function panelServer(reply: () => Response): FakeServer {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A');
  server.addChat(subject.id, { id: 'chat-1' });
  server.replyOnce('GET', '/api/chats/chat-1/files', reply);
  return server;
}

/** Das Panel braucht die Sitzung (Api-Zugriff); im Direktest kommt sie vom Server-Ersatz. */
function mountPanel(server: FakeServer) {
  return render(
    <SessionProvider client={new ApiClient({ fetch: server.fetch })}>
      <FilePanel chatId="chat-1" />
    </SessionProvider>,
  );
}

describe('FilePanel: Liste (H-C02)', () => {
  it('rendert Einträge mit Name und Größe und den Download nur für über die Asset-Route ladbare Dateien', async () => {
    const server = panelServer(() => json(200, { files, truncated: false }));
    server.chatMessages.set('chat-1', [messageWithAssets('m1')]);
    mountPanel(server);

    expect(await screen.findByTitle('bericht.txt')).toBeTruthy();
    expect(screen.getByTitle('tabelle.csv')).toBeTruthy();
    expect(screen.getByTitle('ohne-endung')).toBeTruthy();
    expect(screen.getByText('2 KB')).toBeTruthy();
    expect(screen.getByText('512 B')).toBeTruthy();

    // Nur „bericht.txt“ hat einen Download-Knopf (Asset-Route); die anderen erscheinen ohne.
    const zeileBericht = screen.getByTitle('bericht.txt').closest('li') as HTMLElement;
    const knopf = within(zeileBericht).getByRole('link', {
      name: 'bericht.txt herunterladen (2 KB)',
    });
    const zeileTabelle = screen.getByTitle('tabelle.csv').closest('li') as HTMLElement;
    expect(within(zeileTabelle).queryByRole('link')).toBeNull();
    const zeileOhne = screen.getByTitle('ohne-endung').closest('li') as HTMLElement;
    expect(within(zeileOhne).queryByRole('link')).toBeNull();
    // Die Download-Adresse ist die bestehende Asset-Route, kein neuer Endpoint.
    expect(knopf.getAttribute('href')).toBe('/api/assets/asset-1/download');
    // CSP: kein Inline-Stil im Markup.
    expect(document.querySelector('[style]')).toBeNull();
  });

  it('zeigt den truncated-Hinweis, wenn der Server mehr hat, als gezeigt wird', async () => {
    const server = panelServer(() => json(200, { files: files.slice(0, 1), truncated: true }));
    mountPanel(server);

    expect(await screen.findByText('Es werden die ersten 200 Dateien gezeigt.')).toBeTruthy();
  });

  it('zeigt einen Leer-Zustand ohne Liste', async () => {
    const server = panelServer(() => json(200, { files: [], truncated: false }));
    mountPanel(server);

    expect(await screen.findByText('Noch keine Dateien in diesem Chat.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('zeigt beim Scheitern der Anfrage einen Fehlerzustand mit „Erneut versuchen“ und lädt danach neu', async () => {
    const server = panelServer(() => json(500, { error: 'internal' }));
    // Der zweite Versuch gelingt: der Server-Ersatz antwortet diesmal mit einer leeren Liste.
    server.replyOnce('GET', '/api/chats/chat-1/files', () =>
      json(200, { files: [], truncated: false }),
    );
    mountPanel(server);

    expect(await screen.findByText('Die Dateien konnten nicht geladen werden.')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Erneut versuchen/ }));
    expect(await screen.findByText('Noch keine Dateien in diesem Chat.')).toBeTruthy();
    expect(server.calls('GET', '/api/chats/chat-1/files')).toHaveLength(2);
  });

  it('zeigt während des Ladens eine Statusmeldung und danach keine mehr', async () => {
    const server = panelServer(() => json(200, { files, truncated: false }));
    mountPanel(server);

    expect(screen.getByRole('status').textContent).toBe('Dateien werden geladen …');
    expect(await screen.findByTitle('bericht.txt')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('hält den Vorschau-Reiter als Platzhalter bereit, funktional ist nur „Dateien“', async () => {
    const server = panelServer(() => json(200, { files, truncated: false }));
    mountPanel(server);

    const tablist = await screen.findByRole('tablist', { name: 'Dateien des Chats' });
    expect(within(tablist).getByRole('tab', { name: 'Dateien', selected: true })).toBeTruthy();
    expect(within(tablist).getByRole('tab', { name: 'Vorschau', selected: false })).toBeTruthy();

    const user = userEvent.setup();
    await user.click(within(tablist).getByRole('tab', { name: 'Vorschau' }));
    expect(await screen.findByText('Die Vorschau ist noch nicht verfügbar.')).toBeTruthy();
  });
});

describe('FilePanel: Panel im Chat-Layout (H-C02)', () => {
  it('ist eingeklappt, wenn das Fenster zu schmal ist (jsdom kennt kein matchMedia: immer zu)', async () => {
    const server = new FakeServer('unlocked');
    const subject = server.addSubject('Beispielfach A');
    const provider = server.addProvider('Anbieter A', {
      models: [
        {
          id: 'modell-a',
          vision: false,
          tools: true,
          reasoning: false,
          streaming: true,
          free: false,
        },
      ],
      hasKey: true,
    });
    server.modelSettings = {
      default: { providerId: provider.id, model: 'modell-a' },
      fallback: [],
    };
    const chat = server.addChat(subject.id);
    const { container } = open(server, `/subjects/${subject.id}/chats/${chat.id}`);

    await screen.findByRole('heading', { level: 1, name: 'Neuer Chat' });
    const bereich = container.querySelector('.lg-chat-panel-bereich');
    expect(bereich).not.toBeNull();
    expect(bereich?.getAttribute('data-panel')).toBe('closed');
    expect(container.querySelector('.lg-chat-panel')).toBeNull();
    // Der Auf-/Zuklappknopf ist eine 44-px-Fläche und trägt seinen zugänglichen Namen.
    const knopf = screen.getByRole('button', { name: 'Dateien anzeigen' });
    expect(knopf.className).toContain('size-11');
    expect(knopf.getAttribute('aria-expanded')).toBe('false');
  });

  it('klappt auf Knopfdruck auf, ohne dass ein Inline-Stil ins Markup gerät', async () => {
    const server = new FakeServer('unlocked');
    const subject = server.addSubject('Beispielfach A');
    const provider = server.addProvider('Anbieter A', {
      models: [
        {
          id: 'modell-a',
          vision: false,
          tools: true,
          reasoning: false,
          streaming: true,
          free: false,
        },
      ],
      hasKey: true,
    });
    server.modelSettings = {
      default: { providerId: provider.id, model: 'modell-a' },
      fallback: [],
    };
    const chat = server.addChat(subject.id);
    const { container } = open(server, `/subjects/${subject.id}/chats/${chat.id}`);

    await screen.findByRole('heading', { level: 1, name: 'Neuer Chat' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Dateien anzeigen' }));

    const bereich = container.querySelector('.lg-chat-mit-panel');
    expect(bereich).not.toBeNull();
    expect(bereich?.getAttribute('data-panel')).toBe('open');
    // Das Panel liegt rechts NEBEN der Chat-Spalte (kein Overlay): ein Panel-Bereich mit Panel.
    expect(container.querySelector('.lg-chat-panel')).not.toBeNull();
    expect(screen.getByRole('separator', { name: 'Dateien des Chats' })).toBeTruthy();
    // Die Breite geht als CSS-Variable über das CSSOM, nie als style-Attribut mit Werten (CSP, Regel 5).
    expect(bereich?.getAttribute('style')).toContain('--panel-w: 320px');
    await user.click(screen.getByRole('button', { name: 'Dateien verbergen' }));
    expect(container.querySelector('.lg-chat-panel')).toBeNull();
    // Nach dem Zuklappen ist die Variable wieder weg (leeres style-Attribut vom CSSOM).
    expect(bereich?.getAttribute('style') ?? '').toBe('');
  });
});

function open(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}
