#!/usr/bin/env node
import fs from 'node:fs';
// Ersatz für die Anthropic Messages API (ESM, ohne Abhängigkeiten), nur für den E2E-Test mit dem echten
// Programm „claude“ (agents/e2e.test.ts). Kein Netz, keine Konten, keine echten Schlüssel.
// Aufruf: node fake-anthropic.mjs [port] [logfile]   (Port 0/leer = zufällig; Port wird auf stdout ausgegeben)
// Szenario-Marker im letzten Nutzertext:
//   [[szenario:text]]            mehrsaetzige Antwort in mehreren Stuecken
//   [[szenario:write]]           tool_use Write (ergebnis.txt), danach Abschlusstext
//   [[szenario:bash:<befehl>]]   tool_use Bash
//   [[szenario:read:<pfad>]]     tool_use Read
//   [[szenario:error429]]        HTTP 429 mit Nachricht „x“ (ohne Fehlernummer im Text)
//   [[szenario:error1113]]       HTTP 429, die Fehlernummer 1113 steht im Text der Nachricht
//   [[szenario:error401]]        HTTP 401
//   [[szenario:slow]]            streamt >60 s langsam
//   [[szenario:write:<pfad>]]    wie write, aber mit festem Pfad
//   [[szenario:bigtext]]         ~1,5 MB Text in drei Deltas
//   [[szenario:echo]]            gibt Zusammenfassung der Anfrage (Anzahl Nachrichten, system-Laenge, Marker im system) als Text zurueck
import http from 'node:http';
import path from 'node:path';

const port = Number(process.argv[2] || 0);
const logFile = process.argv[3] || null;
const REQDUMP = process.env.FAKE_DUMP_DIR || ''; // wenn gesetzt: komplette Request-Bodies dorthin schreiben
let reqCounter = 0;

function log(obj) {
  if (!logFile) return;
  fs.appendFileSync(logFile, `${JSON.stringify({ t: new Date().toISOString(), ...obj })}\n`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = (p) => `${p}_${Math.random().toString(36).slice(2, 14)}`;

function textOfContent(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}
function hasToolResult(c) {
  return Array.isArray(c) && c.some((b) => b && b.type === 'tool_result');
}
function allText(body) {
  const parts = [];
  for (const m of body.messages || []) parts.push(textOfContent(m.content));
  return parts.join('\n');
}
const MARK = /\[\[szenario:([a-z0-9]+)(?::([^\]]*))?\]\]/i;
function findScenario(body) {
  const msgs = body.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'user') continue;
    const t = textOfContent(m.content);
    const mm = t.match(MARK);
    if (mm) return { name: mm[1].toLowerCase(), arg: mm[2] };
  }
  return null;
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function usage(inp, out) {
  return {
    input_tokens: inp,
    output_tokens: out,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

async function streamText(res, model, chunks, { delay = 30, stop = 'end_turn' } = {}) {
  const id = rid('msg');
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'request-id': rid('req'),
  });
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: usage(25, 1),
    },
  });
  sse(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });
  sse(res, 'ping', { type: 'ping' });
  for (const c of chunks) {
    if (res.destroyed || res.writableEnded) return;
    sse(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: c },
    });
    await sleep(delay);
  }
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stop, stop_sequence: null },
    usage: usage(25, chunks.join('').length >> 2 || 1),
  });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

async function streamToolUse(res, model, name, input, preText) {
  const id = rid('msg');
  const toolId = rid('toolu');
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'request-id': rid('req'),
  });
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: usage(30, 1),
    },
  });
  let idx = 0;
  if (preText) {
    sse(res, 'content_block_start', {
      type: 'content_block_start',
      index: idx,
      content_block: { type: 'text', text: '' },
    });
    sse(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: idx,
      delta: { type: 'text_delta', text: preText },
    });
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: idx });
    idx++;
  }
  sse(res, 'content_block_start', {
    type: 'content_block_start',
    index: idx,
    content_block: { type: 'tool_use', id: toolId, name, input: {} },
  });
  const json = JSON.stringify(input);
  const step = Math.max(8, Math.ceil(json.length / 3));
  for (let i = 0; i < json.length; i += step) {
    sse(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: idx,
      delta: { type: 'input_json_delta', partial_json: json.slice(i, i + step) },
    });
    await sleep(20);
  }
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: idx });
  sse(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: usage(30, 40),
  });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

function jsonMessage(res, model, text, stop = 'end_turn') {
  const body = {
    id: rid('msg'),
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: stop,
    stop_sequence: null,
    usage: usage(20, 5),
  };
  res.writeHead(200, { 'content-type': 'application/json', 'request-id': rid('req') });
  res.end(JSON.stringify(body));
}

function jsonToolMessage(res, model, name, input) {
  const body = {
    id: rid('msg'),
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'tool_use', id: rid('toolu'), name, input }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: usage(20, 5),
  };
  res.writeHead(200, { 'content-type': 'application/json', 'request-id': rid('req') });
  res.end(JSON.stringify(body));
}

const TEXT_CHUNKS = [
  'Das ist die erste Antwort. ',
  'Sie kommt in mehreren Stuecken, ',
  'damit man Text-Deltas sieht. ',
  'Zweiter Satz mit Umlauten: aeoeue und Sonderzeichen äöüß €. ',
  'Dritter Satz.\n',
  '\nAbsatz zwei mit **Markdown** und `Code`. ',
  'Ende der Antwort.',
];

const server = http.createServer(async (req, res) => {
  const n = ++reqCounter;
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  await new Promise((r) => req.on('end', r));
  const raw = Buffer.concat(chunks).toString('utf8');
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    /* kein JSON */
  }
  const url = req.url.split('?')[0];
  const headerNames = Object.keys(req.headers).sort();
  const entry = {
    n,
    method: req.method,
    path: req.url,
    host: req.headers.host,
    model: body?.model,
    stream: body?.stream,
    nMessages: body?.messages?.length,
    nTools: Array.isArray(body?.tools) ? body.tools.length : undefined,
    bodyBytes: raw.length,
    headerNames,
    hasAuthHeader: !!req.headers.authorization,
    hasApiKeyHeader: !!req.headers['x-api-key'],
    ua: req.headers['user-agent'],
  };
  if (REQDUMP) {
    try {
      fs.mkdirSync(REQDUMP, { recursive: true });
      fs.writeFileSync(path.join(REQDUMP, `req-${String(n).padStart(3, '0')}.json`), raw);
    } catch {}
  }

  if (req.method === 'POST' && url === '/v1/messages/count_tokens') {
    entry.kind = 'count_tokens';
    log(entry);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ input_tokens: Math.max(1, Math.ceil(raw.length / 4)) }));
    return;
  }

  if (req.method === 'POST' && url === '/v1/messages' && body) {
    const model = body.model || 'fake-model';
    const mainish = Array.isArray(body.tools) && body.tools.length > 0 && !/haiku/i.test(model);
    const sc = findScenario(body);
    const last = (body.messages || [])[body.messages.length - 1];
    const lastIsToolResult = last && last.role === 'user' && hasToolResult(last.content);
    entry.kind = mainish ? 'main' : 'background';
    entry.scenario = sc ? sc.name : null;
    entry.lastIsToolResult = !!lastIsToolResult;
    entry.systemBlocks = Array.isArray(body.system) ? body.system.length : body.system ? 1 : 0;
    log(entry);

    // Hintergrund (Titel, Haiku, ohne Tools): einfacher Text
    if (!mainish) {
      const t = 'Kurzer Titel';
      if (body.stream) return streamText(res, model, [t], { delay: 1 });
      return jsonMessage(res, model, t);
    }
    if (!sc) {
      const t = 'Kein Szenario-Marker gefunden.';
      return body.stream ? streamText(res, model, [t], { delay: 1 }) : jsonMessage(res, model, t);
    }

    if (sc.name === 'error429') {
      res.writeHead(429, { 'content-type': 'application/json', 'request-id': rid('req') });
      res.end(JSON.stringify({ error: { code: '1113', message: 'x' } }));
      return;
    }
    if (sc.name === 'error1113') {
      // Wie Z.ai bei fehlendem Guthaben: 429, die Fehlernummer steht im Text der Nachricht.
      res.writeHead(429, { 'content-type': 'application/json', 'request-id': rid('req') });
      res.end(
        JSON.stringify({
          type: 'error',
          error: {
            type: 'rate_limit_error',
            message: 'Error 1113: insufficient balance or no resource package',
          },
        }),
      );
      return;
    }
    if (sc.name === 'error401') {
      res.writeHead(401, { 'content-type': 'application/json', 'request-id': rid('req') });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid x-api-key (fake)' },
        }),
      );
      return;
    }

    if (lastIsToolResult) {
      const t =
        sc.name === 'write'
          ? 'Fertig: Ich habe ergebnis.txt angelegt.'
          : `Werkzeug ausgefuehrt (${sc.name}). Das war's.`;
      return body.stream
        ? streamText(res, model, ['Fertig: ', t.replace(/^Fertig: /, '')], { delay: 20 })
        : jsonMessage(res, model, t);
    }

    switch (sc.name) {
      case 'text':
        return body.stream
          ? streamText(res, model, TEXT_CHUNKS)
          : jsonMessage(res, model, TEXT_CHUNKS.join(''));
      case 'echo': {
        const sys = Array.isArray(body.system)
          ? body.system.map((b) => b.text || '').join('\n')
          : String(body.system || '');
        const t = `ECHO messages=${body.messages.length} systemChars=${sys.length} sysHas_PAGEWISE_MARKER=${sys.includes('PAGEWISE-SYSTEMPROMPT-MARKER')} allText=${JSON.stringify(allText(body)).slice(0, 600)}`;
        return body.stream ? streamText(res, model, [t], { delay: 1 }) : jsonMessage(res, model, t);
      }
      case 'write': {
        const input = {
          file_path: sc.arg || path.join(process.env.FAKE_WS || process.cwd(), 'ergebnis.txt'),
          content: 'Hallo aus dem Fake-Szenario.\n',
        };
        return body.stream
          ? streamToolUse(res, model, 'Write', input, 'Ich lege die Datei an.')
          : jsonToolMessage(res, model, 'Write', input);
      }
      case 'bash': {
        const input = { command: sc.arg || 'echo hi', description: 'Fake bash' };
        return body.stream
          ? streamToolUse(res, model, 'Bash', input, '')
          : jsonToolMessage(res, model, 'Bash', input);
      }
      case 'read': {
        const input = { file_path: sc.arg || '/etc/hosts' };
        return body.stream
          ? streamToolUse(res, model, 'Read', input, '')
          : jsonToolMessage(res, model, 'Read', input);
      }
      case 'bigtext': {
        // ein sehr grosser Text (~1,5 MB) in drei Stuecken, mit Umlauten und Zeilenumbruechen
        const part = `Gross\u00fc\u00df-Text ${'x'.repeat(490)}\n`.repeat(1000);
        const parts = [part, part, part];
        return body.stream
          ? streamText(res, model, parts, { delay: 5 })
          : jsonMessage(res, model, parts.join(''));
      }
      case 'slow': {
        const words = [];
        for (let i = 0; i < 70; i++) words.push(`Wort${i} `);
        return body.stream
          ? streamText(res, model, words, { delay: 1000 })
          : jsonMessage(res, model, words.join(''));
      }
      default: {
        const t = `Unbekanntes Szenario ${sc.name}`;
        return body.stream ? streamText(res, model, [t], { delay: 1 }) : jsonMessage(res, model, t);
      }
    }
  }

  // alles andere (Telemetrie, Feature-Flags, Updates, ...): protokollieren, 404
  entry.kind = 'other';
  log(entry);
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { type: 'not_found', message: `fake: ${req.method} ${url}` } }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(server.address().port);
});
