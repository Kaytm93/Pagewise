import type {
  ActivityEntry,
  ChatAsset,
  ChatMessage,
  MessageStatus,
  Selection,
  StreamEvent,
} from './types';

export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Zerlegt einen Strom von Server-Sent Events in Nachrichten. Brocken dürfen an beliebiger Stelle
 * enden, auch mitten in einer Zeile oder zwischen `\r` und `\n`. Kommentarzeilen werden ignoriert.
 */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseMessage[] {
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, '\n');
    const messages: SseMessage[] = [];
    for (;;) {
      const end = this.buffer.indexOf('\n\n');
      if (end === -1) break;
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const message = parseBlock(block);
      if (message) messages.push(message);
    }
    return messages;
  }
}

function parseBlock(block: string): SseMessage | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length === 0 ? null : { event, data: data.join('\n') };
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null;
const STATUSES: readonly string[] = ['complete', 'streaming', 'stopped', 'error', 'interrupted'];

const ASSET_KINDS: readonly string[] = ['pdf', 'pptx', 'docx', 'xlsx', 'image', 'text'];
const ACTIVITY_STATES: readonly string[] = ['running', 'done', 'error'];

/** Eintrag der Aktivität eines Agenten. Anzeigetexte werden gekürzt: Der Strom ist nicht vertrauenswürdig. */
export function asActivity(value: unknown): ActivityEntry | null {
  if (!isRecord(value)) return null;
  const { id, tool, target, state } = value;
  if (
    typeof id !== 'string' ||
    typeof tool !== 'string' ||
    typeof state !== 'string' ||
    !ACTIVITY_STATES.includes(state)
  ) {
    return null;
  }
  return {
    id: id.slice(0, 100),
    tool: tool.slice(0, 40),
    target: typeof target === 'string' ? target.slice(0, 120) : null,
    state: state as ActivityEntry['state'],
  };
}

function asActivityList(value: unknown): ActivityEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry, index) => {
    const parsed = asActivity(
      isRecord(entry) && entry.id === undefined ? { ...entry, id: String(index) } : entry,
    );
    return parsed ? [parsed] : [];
  });
}

function asAssets(value: unknown): ChatAsset[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const { id, name, kind, mime, size } = entry;
    if (
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      typeof kind !== 'string' ||
      !ASSET_KINDS.includes(kind) ||
      typeof mime !== 'string' ||
      typeof size !== 'number'
    ) {
      return [];
    }
    return [{ id, name, kind: kind as ChatAsset['kind'], mime, size }];
  });
}

function asMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null;
  const { id, seq, role, content, status, providerId, model, errorCode, createdAt } = value;
  if (
    typeof id !== 'string' ||
    typeof seq !== 'number' ||
    (role !== 'user' && role !== 'assistant') ||
    typeof content !== 'string' ||
    typeof status !== 'string' ||
    !STATUSES.includes(status) ||
    typeof createdAt !== 'number'
  ) {
    return null;
  }
  return {
    id,
    seq,
    role,
    content,
    status: status as MessageStatus,
    providerId: typeof providerId === 'string' ? providerId : null,
    model: typeof model === 'string' ? model : null,
    engineProfileId: typeof value.engineProfileId === 'string' ? value.engineProfileId : null,
    errorCode: typeof errorCode === 'string' ? errorCode : null,
    activity: asActivityList(value.activity),
    assets: asAssets(value.assets),
    createdAt,
  };
}

function asSelection(value: unknown): Selection | null {
  if (!isRecord(value)) return null;
  return typeof value.providerId === 'string' && typeof value.model === 'string'
    ? { providerId: value.providerId, model: value.model }
    : null;
}

/**
 * Macht aus einer Nachricht des Servers ein Ereignis. Unbekanntes und Fehlerhaftes ergibt `null` und
 * wird ignoriert: Der Strom ist eine Eingabe von außen und wird nie blind übernommen.
 */
export function parseStreamEvent(message: SseMessage): StreamEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(message.data);
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;

  switch (message.event) {
    case 'start': {
      const assistantMessage = asMessage(payload.assistantMessage);
      if (!assistantMessage) return null;
      const userMessage = payload.userMessage === null ? null : asMessage(payload.userMessage);
      if (payload.userMessage !== null && !userMessage) return null;
      return { type: 'start', userMessage, assistantMessage };
    }
    case 'snapshot':
      if (typeof payload.assistantMessageId !== 'string' || typeof payload.text !== 'string') {
        return null;
      }
      return {
        type: 'snapshot',
        assistantMessageId: payload.assistantMessageId,
        text: payload.text,
        model: asSelection(payload.model),
        thinking: payload.thinking === true,
        activity: asActivityList(payload.activity),
      };
    case 'model': {
      const selection = asSelection(payload);
      return selection ? { type: 'model', ...selection } : null;
    }
    case 'thinking':
      return { type: 'thinking' };
    case 'delta':
      return typeof payload.text === 'string' ? { type: 'delta', text: payload.text } : null;
    case 'activity': {
      const entry = asActivity(payload.entry);
      return entry ? { type: 'activity', entry } : null;
    }
    case 'done':
    case 'stopped': {
      const final = asMessage(payload.message);
      return final ? { type: message.event, message: final } : null;
    }
    case 'failed': {
      const final = asMessage(payload.message);
      return final && typeof payload.code === 'string'
        ? { type: 'failed', code: payload.code, message: final }
        : null;
    }
    default:
      return null;
  }
}
