import { describe, expect, it } from 'vitest';
import { type AgentEvent, AgentStreamParser, toolTarget } from './stream';

const SESSION = '28a3da41-4031-49c8-924f-41d04fb709ae';

const line = (value: unknown) => JSON.stringify(value);
const delta = (text: string, parent: string | null = null) =>
  line({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    session_id: SESSION,
    parent_tool_use_id: parent,
  });
const messageStart = (parent: string | null = null) =>
  line({
    type: 'stream_event',
    event: { type: 'message_start', message: { id: 'm', role: 'assistant', content: [] } },
    session_id: SESSION,
    parent_tool_use_id: parent,
  });

function run(lines: string[], workspace: string | null = null): AgentEvent[] {
  const parser = new AgentStreamParser(workspace);
  return lines.flatMap((entry) => parser.parse(entry));
}

describe('AgentStreamParser: normaler Verlauf', () => {
  it('liest Sitzung, Textstücke und das Ende', () => {
    const events = run([
      line({ type: 'system', subtype: 'init', session_id: SESSION, model: 'glm-5.3', cwd: '/x' }),
      line({ type: 'system', subtype: 'status', status: 'requesting' }),
      messageStart(),
      delta('Hallo'),
      delta(' Welt'),
      line({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hallo Welt' }] },
        parent_tool_use_id: null,
      }),
      line({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Hallo Welt',
        num_turns: 1,
        duration_ms: 42,
        session_id: SESSION,
      }),
    ]);
    expect(events).toEqual([
      { type: 'session', sessionId: SESSION, model: 'glm-5.3' },
      { type: 'text', text: 'Hallo' },
      { type: 'text', text: ' Welt' },
      {
        type: 'result',
        ok: true,
        text: 'Hallo Welt',
        code: null,
        turns: 1,
        durationMs: 42,
        denied: 0,
        resumeFailed: false,
      },
    ]);
  });

  it('ist unabhängig von der Reihenfolge der Schlüssel in einer Zeile', () => {
    const events = run([
      '{"is_error":false,"result":"fertig","type":"result","num_turns":2,"duration_ms":5}',
    ]);
    expect(events).toEqual([
      {
        type: 'result',
        ok: true,
        text: 'fertig',
        code: null,
        turns: 2,
        durationMs: 5,
        denied: 0,
        resumeFailed: false,
      },
    ]);
  });

  it('trennt Nachrichten nach einem Werkzeugaufruf mit einem Absatz', () => {
    const events = run(
      [
        messageStart(),
        delta('Ich lege die Datei an.'),
        line({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'Write',
                input: { file_path: '/ws/ergebnis.txt', content: 'GEHEIM' },
              },
            ],
          },
          parent_tool_use_id: null,
        }),
        line({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: 'GEHEIMER ERGEBNISTEXT',
                is_error: false,
              },
            ],
          },
          parent_tool_use_id: null,
        }),
        messageStart(),
        delta('Fertig.'),
      ],
      '/ws',
    );
    expect(events).toEqual([
      { type: 'text', text: 'Ich lege die Datei an.' },
      { type: 'tool', id: 'toolu_1', name: 'Write', target: 'ergebnis.txt' },
      { type: 'tool_result', id: 'toolu_1', error: false },
      { type: 'break' },
      { type: 'text', text: 'Fertig.' },
    ]);
    // Weder der Inhalt der Datei noch das Ergebnis des Werkzeugs kommen heraus.
    expect(JSON.stringify(events)).not.toContain('GEHEIM');
  });

  it('meldet fehlgeschlagene Werkzeugergebnisse', () => {
    expect(
      run([
        line({
          type: 'user',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 't9', content: 'x', is_error: true }],
          },
          parent_tool_use_id: null,
        }),
      ]),
    ).toEqual([{ type: 'tool_result', id: 't9', error: true }]);
  });

  it('meldet Denken und Wiederholungen', () => {
    const events = run([
      line({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
        parent_tool_use_id: null,
      }),
      line({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'hm' },
        },
        parent_tool_use_id: null,
      }),
      line({
        type: 'system',
        subtype: 'api_retry',
        attempt: 2,
        max_retries: 5,
        retry_delay_ms: 1000,
        error_status: 429,
        error: 'rate_limit',
      }),
    ]);
    expect(events).toEqual([
      { type: 'thinking' },
      { type: 'thinking' },
      { type: 'retry', attempt: 2, max: 5 },
    ]);
  });
});

describe('AgentStreamParser: Robustheit', () => {
  it('überspringt Unbekanntes, Unsinn und Ereignisse von Unteragenten', () => {
    const events = run([
      'das ist kein JSON',
      '',
      '[]',
      '42',
      '{"type":"unbekannt"}',
      line({ type: 'system', subtype: 'hook_started' }),
      line({ type: 'system', subtype: 'init' }),
      line({ type: 'stream_event', event: { type: 'ping' } }),
      line({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{' },
        },
      }),
      delta('von einem Unteragenten', 'toolu_x'),
      messageStart('toolu_x'),
      line({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'a', name: 'Read', input: {} }] },
        parent_tool_use_id: 'toolu_x',
      }),
      line({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'a' }] },
        parent_tool_use_id: 'toolu_x',
      }),
    ]);
    expect(events).toEqual([]);
  });

  it('übergeht leere Textstücke und Werkzeugaufrufe ohne Namen', () => {
    expect(
      run([
        delta(''),
        line({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'x' },
              { type: 'text', text: 'x' },
            ],
          },
          parent_tool_use_id: null,
        }),
      ]),
    ).toEqual([]);
  });
});

describe('AgentStreamParser: Fehler werden zu Codes, nie zu Text', () => {
  const resultLine = (extra: Record<string, unknown>) =>
    line({
      type: 'result',
      subtype: 'success',
      is_error: true,
      num_turns: 1,
      duration_ms: 3,
      session_id: SESSION,
      ...extra,
    });

  it.each([
    [
      {
        result: 'Not logged in · Please run /login',
        api_error_status: 401,
        terminal_reason: 'api_error',
      },
      'auth_failed',
    ],
    [
      { result: 'API Error: Request rejected (429) · zu viele', api_error_status: 429 },
      'rate_limited',
    ],
    [{ result: 'API Error: 500 gateway', api_error_status: 500 }, 'upstream_error'],
    [{ result: 'API Error: 503', api_error_status: 503 }, 'upstream_error'],
    [
      { result: 'There is an issue with the selected model (glm-5.3).', api_error_status: 404 },
      'model_not_found',
    ],
    [{ result: 'API Error: 402 Payment', api_error_status: 402 }, 'insufficient_credits'],
    [{ result: 'irgendwas', terminal_reason: 'budget_exhausted' }, 'agent_limit'],
    [{ result: 'irgendwas', subtype: 'error_max_turns' }, 'agent_limit'],
    [{ result: 'irgendwas anderes' }, 'agent_failed'],
  ])('ordnet %j dem Code %s zu', (extra, code) => {
    const events = run([resultLine(extra)]);
    expect(events).toEqual([
      {
        type: 'result',
        ok: false,
        text: '',
        code,
        turns: 1,
        durationMs: 3,
        denied: 0,
        resumeFailed: false,
      },
    ]);
  });

  it.each([
    ['1113', 'no_package'],
    ['1211', 'model_not_found'],
    ['1301', 'content_blocked'],
    ['1308', 'quota_exhausted'],
    ['1309', 'plan_expired'],
    ['1310', 'quota_exhausted'],
    ['1311', 'model_not_allowed'],
  ])('erkennt die Z.ai-Nummer %s im Fehlertext des Programms', (number, code) => {
    const events = run([
      resultLine({
        result: `API Error: 429 {"error":{"code":"${number}","message":"Text"}}`,
        api_error_status: 429,
      }),
    ]);
    expect(events[0]).toMatchObject({ ok: false, code });
  });

  it('wertet unbekannte Nummern nicht aus und bleibt beim HTTP-Status', () => {
    const events = run([resultLine({ result: 'Fehler 1999 und 1500', api_error_status: 429 })]);
    expect(events[0]).toMatchObject({ code: 'rate_limited' });
  });

  it('nutzt die Art des Fehlers aus der Antwort, wenn der Status fehlt', () => {
    const events = run([
      line({
        type: 'assistant',
        error: 'rate_limit',
        message: { model: '<synthetic>', content: [{ type: 'text', text: 'API Error' }] },
        parent_tool_use_id: null,
      }),
      resultLine({ result: 'API Error: Request rejected' }),
    ]);
    expect(events.at(-1)).toMatchObject({ ok: false, code: 'rate_limited' });
  });

  it('merkt sich den Status aus Wiederholungen', () => {
    const events = run([
      line({
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 3,
        error_status: 401,
        error: 'authentication_failed',
      }),
      resultLine({ result: 'irgendwas' }),
    ]);
    expect(events.at(-1)).toMatchObject({ code: 'auth_failed' });
  });

  it('erkennt eine nicht mehr vorhandene Sitzung', () => {
    const events = run([
      line({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        num_turns: 0,
        errors: ['No conversation found with session ID: 28a3da41-4031-49c8-924f-41d04fb709ae'],
      }),
    ]);
    expect(events[0]).toMatchObject({ ok: false, resumeFailed: true });
  });

  it('zählt verweigerte Zugriffe, ohne ihre Inhalte weiterzugeben', () => {
    const events = run([
      line({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'ok',
        permission_denials: [
          { tool_name: 'Read', tool_use_id: 't', tool_input: { file_path: '/etc/geheim' } },
          { tool_name: 'Write', tool_use_id: 'u', tool_input: { file_path: '/aussen/x' } },
        ],
      }),
    ]);
    expect(events[0]).toMatchObject({ ok: true, denied: 2 });
    expect(JSON.stringify(events)).not.toContain('geheim');
  });

  it('gibt nie den Fehlertext, den Schlüssel oder Eingaben weiter', () => {
    const secret = ['beispiel', 'token', 'abcdefghijklmnop'].join('-');
    const events = run([
      line({
        type: 'assistant',
        error: 'unknown',
        message: { content: [{ type: 'text', text: `Ungültiger Schlüssel ${secret}` }] },
        parent_tool_use_id: null,
      }),
      resultLine({
        result: `Ungültiger Schlüssel ${secret}, Eingabe: geheimer Schulinhalt`,
        api_error_status: 400,
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain('geheimer');
    expect(events.at(-1)).toMatchObject({ ok: false, text: '', code: 'agent_failed' });
  });
});

describe('toolTarget', () => {
  it('zeigt bei Dateiwerkzeugen die Datei relativ zum Arbeitsordner', () => {
    expect(toolTarget('Write', { file_path: '/ws/unter/a.pdf' }, '/ws')).toBe('unter/a.pdf');
    expect(toolTarget('Read', { file_path: '/anderswo/b.txt' }, '/ws')).toBe('/anderswo/b.txt');
    expect(toolTarget('Edit', { file_path: 'relativ.md' }, null)).toBe('relativ.md');
  });

  it('zeigt bei Bash die Beschreibung, sonst den Anfang des Befehls, gekürzt und ohne Steuerzeichen', () => {
    expect(toolTarget('Bash', { description: 'PDF erzeugen', command: 'python3 x.py' }, null)).toBe(
      'PDF erzeugen',
    );
    expect(toolTarget('Bash', { command: 'echo a\nechos b' }, null)).toBe('echo a echos b');
    const long = toolTarget('Bash', { command: 'x'.repeat(500) }, null) ?? '';
    expect([...long].length).toBe(120);
    expect(long.endsWith('…')).toBe(true);
  });

  it('zeigt bei Suchwerkzeugen das Muster und sonst nichts', () => {
    expect(toolTarget('Grep', { pattern: 'abc' }, null)).toBe('abc');
    expect(toolTarget('Glob', {}, null)).toBeNull();
    expect(toolTarget('Write', 'kein Objekt', null)).toBeNull();
  });
});
