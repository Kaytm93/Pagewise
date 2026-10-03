import { ProviderError } from './errors';

export interface SseEvent {
  event: string | null;
  data: string;
}

export interface SseLimits {
  /** Längste Zeile in Zeichen. */
  maxLine: number;
  /** Größte Nutzlast eines Ereignisses in Zeichen. */
  maxEvent: number;
}

const DEFAULT_LIMITS: SseLimits = { maxLine: 1_000_000, maxEvent: 1_000_000 };
const LINE_END = /\r\n|\n|\r/;

/**
 * Liest einen Server-Sent-Events-Strom (https://html.spec.whatwg.org/multipage/server-sent-events.html).
 * Kommentarzeilen (zum Beispiel Keep-alive) werden ignoriert. Zeilenenden, die über Blockgrenzen
 * hinweg geteilt sind, und mehrbyteige Zeichen an Blockgrenzen werden korrekt behandelt.
 */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  onChunk: () => void = () => {},
  limits: SseLimits = DEFAULT_LIMITS,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let event: string | null = null;
  let data: string[] = [];
  let dataSize = 0;

  const flush = (): SseEvent | null => {
    const result = data.length > 0 ? { event, data: data.join('\n') } : null;
    event = null;
    data = [];
    dataSize = 0;
    return result;
  };

  const handleLine = (line: string): SseEvent | null => {
    if (line === '') return flush();
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') {
      dataSize += value.length + 1;
      if (dataSize > limits.maxEvent) throw new ProviderError('invalid_response');
      data.push(value);
    } else if (field === 'event') {
      event = value;
    }
    return null;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        onChunk();
        buffer += decoder.decode(value, { stream: true });
      }
      if (done) buffer += decoder.decode();

      for (;;) {
        const match = LINE_END.exec(buffer);
        if (!match) break;
        // Ein „\r“ am Ende des Puffers kann der erste Teil von „\r\n“ sein: auf mehr warten.
        if (match[0] === '\r' && match.index === buffer.length - 1 && !done) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const emitted = handleLine(line);
        if (emitted) yield emitted;
      }
      if (buffer.length > limits.maxLine) throw new ProviderError('invalid_response');

      if (done) {
        if (buffer !== '') {
          const emitted = handleLine(buffer);
          buffer = '';
          if (emitted) yield emitted;
        }
        const last = flush();
        if (last) yield last;
        return;
      }
    }
  } finally {
    // Gibt die Verbindung frei, auch wenn der Aufrufer früh aufhört oder abbricht.
    reader.cancel().catch(() => {});
  }
}
