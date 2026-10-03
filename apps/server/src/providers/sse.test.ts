import { describe, expect, it } from 'vitest';
import { ProviderError } from './errors';
import { readSse, type SseEvent } from './sse';

const encoder = new TextEncoder();

function stream(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

async function collect(
  chunks: (string | Uint8Array)[],
  limits?: { maxLine: number; maxEvent: number },
): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of readSse(stream(chunks), () => {}, limits)) events.push(event);
  return events;
}

describe('readSse', () => {
  it('liest Ereignisse mit LF, CRLF und CR als Zeilenende', async () => {
    expect(await collect(['data: a\n\ndata: b\r\n\r\ndata: c\r\r'])).toEqual([
      { event: null, data: 'a' },
      { event: null, data: 'b' },
      { event: null, data: 'c' },
    ]);
  });

  it('fügt mehrere data-Zeilen mit Zeilenumbruch zusammen und merkt sich den Ereignisnamen', async () => {
    expect(await collect(['event: teil\ndata: eins\ndata: zwei\n\n'])).toEqual([
      { event: 'teil', data: 'eins\nzwei' },
    ]);
  });

  it('ignoriert Kommentare, unbekannte Felder und Ereignisse ohne Daten', async () => {
    expect(
      await collect([
        ': OPENROUTER PROCESSING\n\nid: 5\nretry: 10\n\n: noch ein Kommentar\ndata: x\n\n',
      ]),
    ).toEqual([{ event: null, data: 'x' }]);
  });

  it('entfernt nur das erste Leerzeichen nach dem Doppelpunkt', async () => {
    expect(await collect(['data:  zwei Leerzeichen\n\ndata:ohne\n\ndata\n\n'])).toEqual([
      { event: null, data: ' zwei Leerzeichen' },
      { event: null, data: 'ohne' },
      { event: null, data: '' },
    ]);
  });

  it('setzt Zeilen zusammen, die über Blockgrenzen geteilt sind', async () => {
    expect(await collect(['da', 'ta: ab', 'c\n', '\ndata: d\n', '\n'])).toEqual([
      { event: null, data: 'abc' },
      { event: null, data: 'd' },
    ]);
  });

  it('behandelt ein geteiltes CRLF als ein Zeilenende', async () => {
    expect(await collect(['data: a\r', '\n\r', '\ndata: b\n\n'])).toEqual([
      { event: null, data: 'a' },
      { event: null, data: 'b' },
    ]);
  });

  it('dekodiert Zeichen, deren Bytes auf zwei Blöcke verteilt sind', async () => {
    const bytes = encoder.encode('data: Größe ä €\n\n');
    for (let cut = 1; cut < bytes.length; cut += 1) {
      const events = await collect([bytes.slice(0, cut), bytes.slice(cut)]);
      expect(events).toEqual([{ event: null, data: 'Größe ä €' }]);
    }
  });

  it('gibt ein letztes Ereignis ohne abschließende Leerzeile aus', async () => {
    expect(await collect(['data: a\n\ndata: letztes'])).toEqual([
      { event: null, data: 'a' },
      { event: null, data: 'letztes' },
    ]);
  });

  it('gibt bei leerem Strom nichts aus', async () => {
    expect(await collect([])).toEqual([]);
  });

  it('bricht bei zu langen Zeilen und Ereignissen ab', async () => {
    const limits = { maxLine: 50, maxEvent: 30 };
    await expect(collect([`data: ${'x'.repeat(60)}`], limits)).rejects.toBeInstanceOf(
      ProviderError,
    );
    await expect(
      collect(['data: aaaaaaaaaaaaaaaa\ndata: bbbbbbbbbbbbbbbb\n\n'], limits),
    ).rejects.toThrow('invalid_response');
  });

  it('gibt die Verbindung frei, wenn der Aufrufer früh aufhört', async () => {
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode('data: x\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const _ of readSse(source)) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toBe(true);
  });
});
