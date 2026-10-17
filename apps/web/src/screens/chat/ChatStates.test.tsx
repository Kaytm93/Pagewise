// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { ApiClient } from '../../api/client';
import { FakeServer, json } from '../../test/fake-server';

/*
 * chat-render#10: Die Zweige „loading“ und „error“ der Chatansicht lieferten einen nackten
 * Absatz ohne Blatt — der Text lag je Richtung unterschiedlich lose auf dem Untergrund, statt
 * wie im geladenen Chat auf dem Blatt (Muster M4-T027, AppShell.suspense.test.tsx). Beide
 * Zweige liegen jetzt auf <Sheet flush>. jsdom kann Flächen und Höhensprung nicht messen;
 * das misst das Skript pw/agents/m4-t020/messung.mjs im Echtbrowser (Chromium + WebKit).
 */

function setup() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A');
  const chat = server.addChat(subject.id);
  return { server, subject, chat };
}

function open(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

const chatPath = (subjectId: string, chatId: string) => `/subjects/${subjectId}/chats/${chatId}`;

// Eine Antwort, deren Körper nie eintrifft: GET /api/chats/<id> bleibt offen, die Ansicht
// hält den Ladezustand (kein ApiError, kein Inhalt).
const haengt = () =>
  new Response(
    new ReadableStream({
      start() {
        // bewusst leer: der Strom wird nie geschlossen
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

// Die Chatansicht wird beim ersten Öffnen nachgeladen (Suspense); einmal vorab laden wie in Chat.test.tsx.
beforeAll(async () => {
  await import('./ChatPage');
}, 30_000);

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Lade- und Fehlerzustand des Chats liegen auf dem Blatt', () => {
  it('zeigt die Lademeldung auf dem Blatt, nicht als nackten Absatz', async () => {
    const { server, subject, chat } = setup();
    // GET /api/chats/<id> hängt dauerhaft: die Ansicht bleibt im Ladezustand.
    server.replyOnce('GET', `/api/chats/${chat.id}`, haengt);
    open(server, chatPath(subject.id, chat.id));

    expect(await screen.findByText('Chat wird geladen …')).toBeTruthy();
    const status = screen.getByRole('status');
    expect(status.closest('.lg-sheet')).not.toBeNull();
  });

  it('die Fehlermeldung liegt ebenfalls auf dem Blatt', async () => {
    const { server, subject, chat } = setup();
    server.replyOnce('GET', `/api/chats/${chat.id}`, () => json(500, { error: 'internal' }));
    open(server, chatPath(subject.id, chat.id));

    expect(await screen.findByText('Der Chat konnte nicht geladen werden.')).toBeTruthy();
    const sheet = screen
      .getByText('Der Chat konnte nicht geladen werden.')
      .closest('.lg-sheet') as HTMLElement;
    expect(sheet).not.toBeNull();
  });

  it('im Fehlerfall bleibt „Erneut versuchen“ bedienbar und liegt auf dem Blatt', async () => {
    const { server, subject, chat } = setup();
    server.replyOnce('GET', `/api/chats/${chat.id}`, () => json(500, { error: 'internal' }));
    open(server, chatPath(subject.id, chat.id));

    const retry = await screen.findByRole('button', { name: 'Erneut versuchen' });
    expect(retry.closest('.lg-sheet')).not.toBeNull();
  });

  it('keine Bewegung im Ladezustand (fx-Regeln)', async () => {
    const { server, subject, chat } = setup();
    server.replyOnce('GET', `/api/chats/${chat.id}`, haengt);
    open(server, chatPath(subject.id, chat.id));

    expect(await screen.findByText('Chat wird geladen …')).toBeTruthy();
    const sheet = screen.getByRole('status').closest('.lg-sheet') as HTMLElement;
    expect(sheet).not.toBeNull();
    expect(sheet.className).not.toMatch(/animate-|transition-|duration-/);
  });
});
