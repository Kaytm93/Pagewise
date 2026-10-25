// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { ApiClient } from '../../api/client';
import type { ChatMessage } from '../../api/types';
import { FakeServer } from '../../test/fake-server';
import { chatPhase } from './SubjectAtelierChat';

/*
 * Chat in „Atelier“: Randmotiv des Fachs (reine Zier), Kopf mit Status und der Composer mit seinen Haken
 * (`.lg-composer`, `data-subj`). „Raum“ und „Lagen“ zeigen nichts davon. Alle Namen sind erfunden.
 */

const MODEL = { id: 'modell-a', vision: false, tools: true, reasoning: false, streaming: true };

function setup({ answered = false } = {}) {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach Atelier', { color: 2, icon: 'flask' });
  const provider = server.addProvider('Anbieter A', {
    models: [{ ...MODEL, free: false }],
    hasKey: true,
  });
  server.modelSettings = { default: { providerId: provider.id, model: 'modell-a' }, fallback: [] };
  const chat = server.addChat(subject.id);
  if (answered) {
    server.addMessage(chat.id, 'user', 'Beispielfrage');
    server.addMessage(chat.id, 'assistant', 'Beispielantwort');
  }
  return { server, subject, chat };
}

function open(server: FakeServer, path: string, design: 'raum' | 'lagen' | 'atelier') {
  document.documentElement.setAttribute('data-design', design);
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

const chatPath = (subjectId: string, chatId: string) => `/subjects/${subjectId}/chats/${chatId}`;

// Die Chatansicht wird beim ersten Öffnen nachgeladen; einmal vorab laden wie in ChatHead.test.tsx.
beforeAll(async () => {
  await import('../chat/ChatPage');
}, 30_000);

afterEach(() => {
  document.documentElement.removeAttribute('data-design');
  window.history.replaceState(null, '', '/');
});

const message = (status: ChatMessage['status'], role: ChatMessage['role'] = 'assistant') =>
  ({ role, status }) as ChatMessage;

describe('chatPhase', () => {
  it('nennt „denkt“ und „schreibt“, solange eine Antwort läuft', () => {
    expect(chatPhase({ running: true, thinking: true, last: undefined })).toBe('thinking');
    expect(chatPhase({ running: true, thinking: false, last: message('streaming') })).toBe(
      'writing',
    );
  });

  it('leitet danach den Zustand aus der letzten Nachricht ab', () => {
    const idle = { running: false, thinking: false };
    expect(chatPhase({ ...idle, last: undefined })).toBe('ready');
    expect(chatPhase({ ...idle, last: message('complete', 'user') })).toBe('ready');
    expect(chatPhase({ ...idle, last: message('complete') })).toBe('done');
    expect(chatPhase({ ...idle, last: message('stopped') })).toBe('stopped');
    expect(chatPhase({ ...idle, last: message('interrupted') })).toBe('stopped');
    expect(chatPhase({ ...idle, last: message('error') })).toBe('failed');
  });
});

describe('Chat in „Atelier“', () => {
  it('zeigt Randmotiv, Kopf mit Status und den Composer mit seinen Haken', async () => {
    const { server, subject, chat } = setup();
    const { container } = open(server, chatPath(subject.id, chat.id), 'atelier');
    await screen.findByRole('heading', { level: 1, name: 'Neuer Chat' });

    // Das Randmotiv ist Zier: für Hilfsmittel unsichtbar, kein Inline-Style, nicht im Lesebereich.
    const rand = container.querySelector('.at-chat-edge') as HTMLElement;
    expect(rand.getAttribute('aria-hidden')).toBe('true');
    expect(rand.querySelector('svg[data-motif="flask"].at-chat-motif')).not.toBeNull();
    expect(rand.querySelector('[style]')).toBeNull();
    const lesebereich = screen.getByRole('region', { name: 'Nachrichten' });
    expect(lesebereich.contains(rand)).toBe(false);

    // Kopf: Modell-Knopf bleibt, daneben der Status (noch keine Antwort: „bereit“).
    const kopf = container.querySelector('.at-chat-head') as HTMLElement;
    const status = kopf.querySelector('.at-chat-status') as HTMLElement;
    expect(status.getAttribute('data-state')).toBe('ready');
    expect(status.textContent).toBe('bereit');
    expect(kopf.querySelector('#chat-title')).not.toBeNull();

    // Composer und unterer Streifen tragen die Haken für das Styling.
    const composer = container.querySelector('form.lg-composer') as HTMLElement;
    expect(composer.getAttribute('data-subj')).toBe('2');
    expect(container.querySelector('.at-chat-dock')?.contains(composer)).toBe(true);
  });

  it('nennt „fertig“, wenn die letzte Antwort vollständig ist', async () => {
    const { server, subject, chat } = setup({ answered: true });
    const { container } = open(server, chatPath(subject.id, chat.id), 'atelier');
    await screen.findByText('Beispielantwort');
    const status = container.querySelector('.at-chat-status') as HTMLElement;
    expect(status.getAttribute('data-state')).toBe('done');
    expect(status.textContent).toBe('fertig');
  });
});

describe.each(['raum', 'lagen'] as const)('Chat in %s', (design) => {
  it('hat weder Randmotiv noch Atelier-Status', async () => {
    const { server, subject, chat } = setup();
    const { container } = open(server, chatPath(subject.id, chat.id), design);
    await screen.findByRole('heading', { level: 1, name: 'Neuer Chat' });
    expect(container.querySelector('.at-chat-edge, .at-chat-status, .at-chat-head')).toBeNull();
    expect(container.querySelector('.at-chat-dock')).toBeNull();
    expect(container.querySelector('form.lg-composer')).not.toBeNull();
  });
});
