import type { ActivityEntry, Chat, ChatDetail, ChatMessage, StreamEvent } from '../../api/types';

export interface ChatState {
  phase: 'loading' | 'ready' | 'not-found' | 'error';
  chat: Chat | null;
  messages: ChatMessage[];
  /** Kennung der Antwort, die gerade geschrieben wird. */
  liveId: string | null;
  /** Das Modell überlegt noch (Denkphase), es gibt noch keinen Text. */
  thinking: boolean;
}

export type ChatAction =
  | { type: 'loaded'; detail: ChatDetail }
  | { type: 'load-failed'; notFound: boolean }
  | { type: 'meta'; chat: Chat }
  | { type: 'event'; event: StreamEvent };

export const initialChatState: ChatState = {
  phase: 'loading',
  chat: null,
  messages: [],
  liveId: null,
  thinking: false,
};

/** Setzt eine Nachricht ein oder ersetzt die mit gleicher Kennung; die Reihenfolge folgt `seq`. */
function upsert(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((entry) => entry.id === message.id);
  if (index !== -1) return messages.map((entry, at) => (at === index ? message : entry));
  return [...messages, message].sort((a, b) => a.seq - b.seq);
}

function patchLive(state: ChatState, change: (message: ChatMessage) => ChatMessage): ChatMessage[] {
  if (!state.liveId) return state.messages;
  return state.messages.map((entry) => (entry.id === state.liveId ? change(entry) : entry));
}

/** Setzt einen Schritt ein oder ersetzt den mit gleicher Kennung. */
function upsertActivity(list: ActivityEntry[], entry: ActivityEntry): ActivityEntry[] {
  const index = list.findIndex((item) => item.id === entry.id);
  if (index === -1) return [...list, entry];
  return list.map((item, at) => (at === index ? entry : item));
}

function withGenerating(chat: Chat | null, generating: boolean): Chat | null {
  return chat ? { ...chat, generating } : chat;
}

function applyEvent(state: ChatState, event: StreamEvent): ChatState {
  switch (event.type) {
    case 'start': {
      // „Erneut versuchen“ ersetzt die letzte unfertige Antwort; der Server hat sie schon gelöscht.
      let messages = state.messages;
      if (event.userMessage === null) {
        const last = messages[messages.length - 1];
        if (last && last.role === 'assistant' && last.status !== 'complete') {
          messages = messages.slice(0, -1);
        }
      } else {
        messages = upsert(messages, event.userMessage);
      }
      return {
        ...state,
        messages: upsert(messages, { ...event.assistantMessage, status: 'streaming' }),
        liveId: event.assistantMessage.id,
        thinking: false,
        chat: withGenerating(state.chat, true),
      };
    }
    case 'snapshot':
      return {
        ...state,
        liveId: event.assistantMessageId,
        thinking: event.thinking,
        chat: withGenerating(state.chat, true),
        messages: state.messages.map((entry) =>
          entry.id === event.assistantMessageId
            ? {
                ...entry,
                content: event.text,
                status: 'streaming',
                providerId: event.model?.providerId ?? entry.providerId,
                model: event.model?.model ?? entry.model,
                activity: event.activity,
              }
            : entry,
        ),
      };
    case 'model':
      return {
        ...state,
        messages: patchLive(state, (entry) => ({
          ...entry,
          providerId: event.providerId,
          model: event.model,
        })),
      };
    case 'activity':
      return {
        ...state,
        messages: patchLive(state, (entry) => ({
          ...entry,
          activity: upsertActivity(entry.activity, event.entry),
        })),
      };
    case 'thinking':
      return { ...state, thinking: true };
    case 'delta':
      return {
        ...state,
        thinking: false,
        messages: patchLive(state, (entry) => ({ ...entry, content: entry.content + event.text })),
      };
    case 'done':
    case 'stopped':
    case 'failed':
      return {
        ...state,
        messages: upsert(state.messages, event.message),
        liveId: null,
        thinking: false,
        chat: withGenerating(state.chat, false),
      };
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'loaded': {
      const { messages, ...chat } = action.detail;
      const live = messages.find((entry) => entry.status === 'streaming' && chat.generating);
      return {
        phase: 'ready',
        chat,
        messages,
        liveId: live?.id ?? null,
        thinking: false,
      };
    }
    case 'load-failed':
      return { ...state, phase: action.notFound ? 'not-found' : 'error' };
    case 'meta':
      // Läuft gerade eine Antwort, bleibt es dabei, auch wenn die Antwort des Servers älter ist.
      return state.chat
        ? {
            ...state,
            chat: { ...action.chat, generating: action.chat.generating || state.liveId !== null },
          }
        : state;
    case 'event':
      return state.phase === 'ready' ? applyEvent(state, action.event) : state;
  }
}
