import { describe, expect, it } from 'vitest';
import type { Chat, ChatDetail, ChatMessage, StreamEvent } from '../../api/types';
import { type ChatAction, type ChatState, chatReducer, initialChatState } from './chat-state';

const chat: Chat = {
  id: 'c1',
  subjectId: 's1',
  groupId: null,
  title: '',
  model: null,
  generating: false,
  createdAt: 1,
  updatedAt: 1,
};

function msg(id: string, seq: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    seq,
    role: seq % 2 === 1 ? 'user' : 'assistant',
    content: '',
    status: 'complete',
    providerId: null,
    model: null,
    errorCode: null,
    createdAt: 1,
    ...extra,
  };
}

function run(actions: ChatAction[], from: ChatState = initialChatState): ChatState {
  return actions.reduce(chatReducer, from);
}

const loaded = (messages: ChatMessage[] = [], extra: Partial<Chat> = {}): ChatAction => ({
  type: 'loaded',
  detail: { ...chat, ...extra, messages } satisfies ChatDetail,
});
const event = (e: StreamEvent): ChatAction => ({ type: 'event', event: e });

describe('chatReducer', () => {
  it('startet im Zustand „lädt“ und ignoriert Ereignisse davor', () => {
    expect(initialChatState.phase).toBe('loading');
    const state = run([event({ type: 'delta', text: 'x' })]);
    expect(state).toEqual(initialChatState);
  });

  it('übernimmt einen geladenen Chat und merkt sich die laufende Antwort', () => {
    const state = run([
      loaded([msg('u1', 1), msg('a1', 2, { status: 'streaming', content: 'Teil' })], {
        generating: true,
      }),
    ]);
    expect(state.phase).toBe('ready');
    expect(state.liveId).toBe('a1');
  });

  it('hält eine unterbrochene Antwort nicht für laufend', () => {
    const state = run([loaded([msg('u1', 1), msg('a1', 2, { status: 'interrupted' })])]);
    expect(state.liveId).toBeNull();
  });

  it('hängt Nachricht und Antwort an und schreibt den Text mit', () => {
    const state = run([
      loaded(),
      event({
        type: 'start',
        userMessage: msg('u1', 1, { content: 'Frage' }),
        assistantMessage: msg('a1', 2, { status: 'streaming' }),
      }),
      event({ type: 'model', providerId: 'p1', model: 'modell-a' }),
      event({ type: 'thinking' }),
    ]);
    expect(state.thinking).toBe(true);
    expect(state.chat?.generating).toBe(true);

    const next = run(
      [event({ type: 'delta', text: 'Hal' }), event({ type: 'delta', text: 'lo' })],
      state,
    );
    expect(next.thinking).toBe(false);
    expect(next.messages.map((entry) => entry.content)).toEqual(['Frage', 'Hallo']);
    expect(next.messages[1]).toMatchObject({ providerId: 'p1', model: 'modell-a' });
  });

  it('ersetzt beim Wiederholen die unfertige Antwort', () => {
    const state = run([
      loaded([msg('u1', 1), msg('a1', 2, { status: 'error', errorCode: 'upstream_error' })]),
      event({
        type: 'start',
        userMessage: null,
        assistantMessage: msg('a2', 2, { status: 'streaming' }),
      }),
    ]);
    expect(state.messages.map((entry) => entry.id)).toEqual(['u1', 'a2']);
  });

  it('lässt beim Wiederholen eine fertige Antwort stehen', () => {
    const state = run([
      loaded([msg('u1', 1), msg('a1', 2, { content: 'fertig' })]),
      event({
        type: 'start',
        userMessage: null,
        assistantMessage: msg('a2', 4, { status: 'streaming' }),
      }),
    ]);
    expect(state.messages.map((entry) => entry.id)).toEqual(['u1', 'a1', 'a2']);
  });

  it('ersetzt beim Wiederanhängen den Text durch den Stand des Servers', () => {
    const state = run([
      loaded([msg('u1', 1), msg('a1', 2, { status: 'streaming', content: 'alt' })], {
        generating: true,
      }),
      event({
        type: 'snapshot',
        assistantMessageId: 'a1',
        text: 'alt und neu',
        model: { providerId: 'p1', model: 'modell-a' },
        thinking: false,
      }),
      event({ type: 'delta', text: '!' }),
    ]);
    expect(state.messages[1]?.content).toBe('alt und neu!');
    expect(state.messages[1]?.model).toBe('modell-a');
    expect(state.liveId).toBe('a1');
  });

  it.each([
    ['done', msg('a1', 2, { content: 'Ende', status: 'complete' })],
    ['stopped', msg('a1', 2, { content: 'Ende', status: 'stopped' })],
  ] as const)('beendet die Antwort mit %s', (type, message) => {
    const state = run([
      loaded([msg('u1', 1), msg('a1', 2, { status: 'streaming', content: 'En' })], {
        generating: true,
      }),
      event({ type, message }),
    ]);
    expect(state.liveId).toBeNull();
    expect(state.chat?.generating).toBe(false);
    expect(state.messages[1]).toEqual(message);
  });

  it('übernimmt bei einem Fehler Code und Teiltext', () => {
    const message = msg('a1', 2, { content: 'Hal', status: 'error', errorCode: 'timeout' });
    const state = run([
      loaded([msg('u1', 1), msg('a1', 2, { status: 'streaming' })], { generating: true }),
      event({ type: 'failed', code: 'timeout', message }),
    ]);
    expect(state.messages[1]).toEqual(message);
    expect(state.liveId).toBeNull();
  });

  it('übernimmt Titel und Wahl, behält aber „es läuft“', () => {
    const state = run([
      loaded([msg('u1', 1), msg('a1', 2, { status: 'streaming' })], { generating: true }),
      { type: 'meta', chat: { ...chat, title: 'Neuer Titel', generating: false } },
    ]);
    expect(state.chat?.title).toBe('Neuer Titel');
    expect(state.chat?.generating).toBe(true);
  });

  it('unterscheidet „nicht gefunden“ von anderen Ladefehlern', () => {
    expect(run([{ type: 'load-failed', notFound: true }]).phase).toBe('not-found');
    expect(run([{ type: 'load-failed', notFound: false }]).phase).toBe('error');
  });
});
