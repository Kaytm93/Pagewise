#!/usr/bin/env node
// Ersatz für das Programm "claude" (Claude Code) in Tests. Er erzeugt dieselbe Ausgabe im Stream-JSON-Format
// wie das echte Programm (gemessen mit 2.1.220), kennt aber weder Netz noch Konten. Das Verhalten steuern
// Marker im Auftrag (stdin). Nur für Tests, nie für den Betrieb.
//
//   [[write:name.pdf]]   legt die Datei im Arbeitsordner an (mit Werkzeug-Ereignissen); mehrere mit Komma: [[write:a.pdf,b.pptx]]
//   [[fail]]             Fehler wie bei Z.ai: 429 mit Nummer 1113
//   [[auth]]             Fehler 401
//   [[slow]]             schreibt etwas und wartet dann (bis zum Abbruch)
//   [[ignoreterm]]       wie slow, ignoriert aber SIGTERM
//   [[huge]]             schreibt eine riesige Zeile
//   [[crash]]            beendet sich ohne Ergebnis mit Exit-Code 2
//   [[nosession]]        schickt keine Sitzungs-ID
//   [[multi]]            zwei Nachrichten mit einem Werkzeugaufruf dazwischen
//   [[sandboxfail]]      meldet beim Start, dass die Sandbox nicht verfügbar ist (Exit 1, kein Ergebnis)
//   [[noresume]]         bei --resume: Sitzung nicht gefunden
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);

if (argv.includes('--version')) {
  if (process.env.FAKE_CLAUDE_BROKEN) {
    process.stderr.write('kaputt\n');
    process.exit(127);
  }
  process.stdout.write(`${process.env.FAKE_CLAUDE_VERSION ?? '9.9.9'} (Claude Code)\n`);
  process.exit(0);
}

const flag = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? null : (argv[index + 1] ?? null);
};

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const prompt = Buffer.concat(chunks).toString('utf8');

const readIfPresent = (path) => {
  try {
    return path ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
};

if (process.env.FAKE_CLAUDE_LOG) {
  // Aufzeichnung für Tests: Argumente, Umgebung, Arbeitsordner, Auftrag und der Inhalt der übergebenen Dateien.
  appendFileSync(
    process.env.FAKE_CLAUDE_LOG,
    `${JSON.stringify({
      argv,
      env: process.env,
      cwd: process.cwd(),
      promptLength: prompt.length,
      prompt,
      stdinWasEmpty: prompt === '',
      settings: readIfPresent(flag('--settings')),
      systemPrompt: readIfPresent(flag('--append-system-prompt-file')),
    })}\n`,
  );
}

const session = flag('--resume') ?? (prompt.includes('[[nosession]]') ? null : randomUUID());
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const parentless = { parent_tool_use_id: null, session_id: session };

if (session) {
  out({
    type: 'system',
    subtype: 'init',
    cwd: process.cwd(),
    session_id: session,
    tools: ['Bash', 'Edit', 'Read', 'Write'],
    model: flag('--model') ?? 'fake-modell',
    permissionMode: flag('--permission-mode') ?? 'default',
    claude_code_version: '9.9.9',
  });
}
out({ type: 'system', subtype: 'status', status: 'requesting', session_id: session });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = () =>
  out({
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: { id: `m_${randomUUID()}`, role: 'assistant', content: [] },
    },
    ...parentless,
  });
const text = (value) =>
  out({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: value } },
    ...parentless,
  });
const result = (extra) =>
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 1,
    duration_ms: 12,
    session_id: session,
    ...extra,
  });
const fail = (status, body, code = 'unknown') => {
  out({
    type: 'assistant',
    error: code,
    message: {
      model: '<synthetic>',
      content: [{ type: 'text', text: `API Error: ${status} ${body}` }],
    },
    ...parentless,
  });
  result({
    is_error: true,
    result: `API Error: ${status} ${body}`,
    terminal_reason: 'api_error',
    api_error_status: status,
  });
  process.exit(1);
};

if (prompt.includes('[[sandboxfail]]')) {
  process.stderr.write('Error: sandbox dependencies are not available (bubblewrap missing)\n');
  process.exit(1);
}
if (flag('--resume') && prompt.includes('[[noresume]]')) {
  out({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    num_turns: 0,
    errors: [`No conversation found with session ID: ${flag('--resume')}`],
    session_id: flag('--resume'),
  });
  process.exit(1);
}
if (prompt.includes('[[auth]]')) fail(401, 'Not logged in', 'authentication_failed');
if (prompt.includes('[[fail]]')) {
  fail(429, '{"error":{"code":"1113","message":"Insufficient balance"}}', 'rate_limit');
}
if (prompt.includes('[[crash]]')) {
  process.stderr.write('Absturz\n');
  process.exit(2);
}
if (prompt.includes('[[ignoreterm]]')) process.on('SIGTERM', () => {});

message();
let answer = `Antwort auf: ${prompt
  .replace(/\[\[[^\]]*\]\]/g, '')
  .trim()
  .slice(0, 30)}`;
if (flag('--resume')) answer += ` (Sitzung ${flag('--resume')})`;

const write = /\[\[write:([^\]]+)\]\]/.exec(prompt);
if (prompt.includes('[[multi]]')) {
  text('Ich lege die Datei an.');
  out({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Write',
          input: { file_path: join(process.cwd(), 'multi.txt'), content: 'GEHEIM' },
        },
      ],
    },
    ...parentless,
  });
  writeFileSync(join(process.cwd(), 'multi.txt'), 'multi');
  out({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: 'GEHEIMES ERGEBNIS',
          is_error: false,
        },
      ],
    },
    ...parentless,
  });
  message();
  text('Fertig.');
  result({ result: 'Fertig.', num_turns: 2 });
  process.exit(0);
}
if (write) {
  // Mehrere Dateien mit Komma getrennt: [[write:a.pdf,b.pptx]]
  const names = write[1].split(',').map((entry) => entry.trim());
  text('Ich erstelle die Datei. ');
  for (const [index, name] of names.entries()) {
    const id = `toolu_w${index}`;
    out({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id,
            name: 'Write',
            input: { file_path: join(process.cwd(), name), content: 'FAKE' },
          },
        ],
      },
      ...parentless,
    });
    writeFileSync(join(process.cwd(), name), `FAKE-INHALT-${name}`);
    out({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: false }],
      },
      ...parentless,
    });
  }
  message();
  text(`Fertig: ${names.join(', ')}`);
  result({
    result: `Ich erstelle die Datei. Fertig: ${names.join(', ')}`,
    num_turns: names.length + 1,
  });
  process.exit(0);
}
if (prompt.includes('[[huge]]')) {
  // process.exit() würde die Ausgabe an einer Pipe nach dem ersten Puffer abschneiden: erst warten, bis alles raus ist.
  process.stdout.write(`${'x'.repeat(9 * 1024 * 1024)}\n`, () => process.exit(0));
  await sleep(60_000);
}
if (prompt.includes('[[slow]]') || prompt.includes('[[ignoreterm]]')) {
  text('Ich arbeite …');
  await sleep(60_000);
  process.exit(0);
}

text(answer.slice(0, 10));
text(answer.slice(10));
result({ result: answer });
process.exit(0);
