// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ApiClient } from '../api/client';
import { FakeServer } from '../test/fake-server';

/*
 * F-108 (Befund shell-home#13): Der Suspense-Fallback beim Öffnen von Chat und Hefteintrag war ein
 * nackter Absatz ohne Blatt — nach dem Nachladen sprang das Blatt von Zeilenhöhe auf volle Höhe
 * (Layout-Shift bis 0,77). Die Fallbacks liegen jetzt wie der Normalfall auf dem Blatt (<Sheet>),
 * ohne Bewegung (fx-Regeln). jsdom kann den Höhensprung nicht messen; layout-shift vorher/nachher
 * misst das Skript pw/agents/m4-t027/messung.mjs im Echtbrowser (Chromium, WebKit: Rechtecke).
 */

// Der Chat hängt beim ersten Darstellen (nachgeladen); der Test gibt ihn später frei.
let chatFrei = false;
let chatLauflassen: (() => void) | null = null;
vi.mock('../screens/chat/ChatPage', () => ({
  ChatPage: () => {
    if (!chatFrei) {
      throw new Promise<void>((resolve) => {
        chatLauflassen = resolve;
      });
    }
    return <h1>Beispielchat</h1>;
  },
}));

// Der Hefteintrag hängt dauerhaft: hier genügt der Blick auf den Fallback selbst.
vi.mock('../screens/notes/NotePage', () => ({
  NotePage: null,
  default: () => {
    throw new Promise<void>(() => {});
  },
}));

function setup() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A');
  const chat = server.addChat(subject.id);
  const note = server.addNote(subject.id);
  return { server, subject, chat, note };
}

const chatPath = (subjectId: string, chatId: string) => `/subjects/${subjectId}/chats/${chatId}`;
const notePath = (subjectId: string, noteId: string) => `/subjects/${subjectId}/notes/${noteId}`;

function open(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  chatFrei = false;
  chatLauflassen = null;
});

describe('Suspense-Fallback liegt auf dem Blatt', () => {
  it('zeigt beim Nachladen des Chats die Meldung auf dem Blatt, nicht als nackten Absatz', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));

    expect(await screen.findByText('Chat wird geladen …')).toBeTruthy();
    const status = screen.getByRole('status');
    expect(status.closest('.lg-sheet')).not.toBeNull();
  });

  it('der Fallback des Chats bringt keine Bewegung mit (fx-Regeln)', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));

    await screen.findByText('Chat wird geladen …');
    const sheet = screen.getByRole('status').closest('.lg-sheet') as HTMLElement;
    expect(sheet.className).not.toMatch(/animate-|transition-|duration-/);
  });

  it('nach dem Nachladen erscheint der Chat und der Fallback verschwindet', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    await screen.findByText('Chat wird geladen …');

    await act(async () => {
      chatFrei = true;
      chatLauflassen?.();
    });
    expect(await screen.findByRole('heading', { name: 'Beispielchat' })).toBeTruthy();
    expect(screen.queryByText('Chat wird geladen …')).toBeNull();
  });

  it('der Fallback des Hefteintrags liegt ebenfalls auf dem Blatt', async () => {
    const { server, subject, note } = setup();
    open(server, notePath(subject.id, note.id));

    expect(await screen.findByText('Hefteintrag wird geladen')).toBeTruthy();
    const status = screen.getByRole('status');
    expect(status.closest('.lg-sheet')).not.toBeNull();
  });
});
