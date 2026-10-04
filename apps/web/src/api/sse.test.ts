import { describe, expect, it } from 'vitest';
import { parseStreamEvent, SseParser } from './sse';

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'm1',
  seq: 2,
  role: 'assistant',
  content: 'Text',
  status: 'complete',
  providerId: 'p1',
  model: 'modell-a',
  errorCode: null,
  createdAt: 1,
  ...overrides,
});

describe('SseParser', () => {
  it('liest Ereignisse mit Namen und Daten', () => {
    const parser = new SseParser();
    expect(parser.push('event: delta\ndata: {"text":"a"}\n\nevent: ping\ndata: {}\n\n')).toEqual([
      { event: 'delta', data: '{"text":"a"}' },
      { event: 'ping', data: '{}' },
    ]);
  });

  it('setzt Ereignisse zusammen, die über mehrere Brocken verteilt ankommen', () => {
    const parser = new SseParser();
    expect(parser.push('event: del')).toEqual([]);
    expect(parser.push('ta\ndata: {"te')).toEqual([]);
    expect(parser.push('xt":"ä"}\n')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ event: 'delta', data: '{"text":"ä"}' }]);
  });

  it('versteht Windows-Zeilenenden, auch wenn \\r und \\n getrennt ankommen', () => {
    const parser = new SseParser();
    expect(parser.push('event: a\r\ndata: 1\r')).toEqual([]);
    expect(parser.push('\n\r\n')).toEqual([{ event: 'a', data: '1' }]);
  });

  it('verbindet mehrere data-Zeilen und ignoriert Kommentare', () => {
    const parser = new SseParser();
    expect(parser.push(': Lebenszeichen\n\nevent: x\ndata: eins\ndata: zwei\n\n')).toEqual([
      { event: 'x', data: 'eins\nzwei' },
    ]);
  });

  it('nennt Ereignisse ohne Namen „message“ und überspringt solche ohne Daten', () => {
    const parser = new SseParser();
    expect(parser.push('data: 1\n\nevent: leer\n\n')).toEqual([{ event: 'message', data: '1' }]);
  });
});

describe('parseStreamEvent', () => {
  const parse = (event: string, data: unknown) =>
    parseStreamEvent({ event, data: JSON.stringify(data) });

  it('liest start mit und ohne Nachricht des Nutzers', () => {
    expect(
      parse('start', {
        userMessage: message({ role: 'user', id: 'u1' }),
        assistantMessage: message({ status: 'streaming', content: '' }),
      }),
    ).toMatchObject({ type: 'start', userMessage: { id: 'u1' }, assistantMessage: { id: 'm1' } });
    expect(
      parse('start', { userMessage: null, assistantMessage: message({ status: 'streaming' }) }),
    ).toMatchObject({ type: 'start', userMessage: null });
  });

  it('liest snapshot, model, thinking und delta', () => {
    expect(
      parse('snapshot', {
        assistantMessageId: 'm1',
        text: 'Hallo',
        model: { providerId: 'p1', model: 'modell-a' },
        thinking: true,
      }),
    ).toEqual({
      type: 'snapshot',
      assistantMessageId: 'm1',
      text: 'Hallo',
      model: { providerId: 'p1', model: 'modell-a' },
      thinking: true,
      activity: [],
    });
    expect(parse('model', { providerId: 'p1', model: 'modell-a' })).toEqual({
      type: 'model',
      providerId: 'p1',
      model: 'modell-a',
    });
    expect(parse('thinking', {})).toEqual({ type: 'thinking' });
    expect(parse('delta', { text: 'x' })).toEqual({ type: 'delta', text: 'x' });
  });

  it('liest Schritte und Dateien eines Agenten und kürzt, was zu lang ist', () => {
    const step = { id: 't1', tool: 'Write', target: 'bericht.pdf', state: 'running' };
    expect(parse('activity', { entry: step })).toEqual({ type: 'activity', entry: step });
    expect(parse('activity', { entry: { ...step, target: 'x'.repeat(500) } })).toMatchObject({
      entry: { target: 'x'.repeat(120) },
    });
    expect(
      parse('snapshot', { assistantMessageId: 'm1', text: '', activity: [step] }),
    ).toMatchObject({
      activity: [step],
    });
    const asset = { id: 'a1', name: 'bericht.pdf', kind: 'pdf', mime: 'application/pdf', size: 10 };
    const done = parse('done', {
      message: message({
        engineProfileId: 'e1',
        activity: [{ tool: 'Write', target: null, state: 'done' }],
        assets: [asset, { ...asset, id: 'a2', kind: 'exe' }, 'kaputt'],
      }),
    });
    expect(done).toMatchObject({
      message: {
        engineProfileId: 'e1',
        activity: [{ id: '0', tool: 'Write', target: null, state: 'done' }],
        assets: [asset],
      },
    });
  });

  it('übernimmt Nachrichten ohne Angaben eines Agenten mit leeren Listen', () => {
    expect(parse('done', { message: message() })).toMatchObject({
      message: { engineProfileId: null, activity: [], assets: [] },
    });
  });

  it('ignoriert ungültige Schritte', () => {
    expect(parse('activity', { entry: { id: 't1', tool: 'Write', state: 'kaputt' } })).toBeNull();
    expect(parse('activity', { entry: 'x' })).toBeNull();
    expect(parse('activity', {})).toBeNull();
  });

  it('liest das Ende einer Antwort', () => {
    expect(parse('done', { message: message() })).toMatchObject({ type: 'done' });
    expect(parse('stopped', { message: message({ status: 'stopped' }) })).toMatchObject({
      type: 'stopped',
    });
    expect(
      parse('failed', { code: 'rate_limited', message: message({ status: 'error' }) }),
    ).toMatchObject({ type: 'failed', code: 'rate_limited' });
  });

  it('ignoriert Unbekanntes, Kaputtes und Falsches', () => {
    expect(parse('ping', {})).toBeNull();
    expect(parse('unbekannt', { a: 1 })).toBeNull();
    expect(parse('delta', { text: 5 })).toBeNull();
    expect(parse('done', { message: message({ status: 'komisch' }) })).toBeNull();
    expect(parse('done', { message: message({ role: 'system' }) })).toBeNull();
    expect(parse('failed', { message: message() })).toBeNull();
    expect(parse('start', { userMessage: 'x', assistantMessage: message() })).toBeNull();
    expect(parseStreamEvent({ event: 'delta', data: 'kein json' })).toBeNull();
    expect(parseStreamEvent({ event: 'delta', data: '[1]' })).toBeNull();
  });
});
