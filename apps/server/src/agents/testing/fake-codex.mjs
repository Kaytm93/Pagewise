#!/usr/bin/env node
// Ersatz für das Programm „codex“ (OpenAI Codex CLI) in Tests. Er erzeugt dieselbe Ausgabe im JSONL-Format
// wie das echte Programm (offizielle Dokumentation: „Non-interactive mode“, ChatGPT Learn, 9.11.2026:
// `codex exec --json` liefert JSON Lines mit thread.started, turn.started/completed/failed, item.* und error),
// kennt aber weder Netz noch Konten. Das Verhalten steuern Marker im Auftrag (stdin). Nur für Tests.
//
//   [[write]]     ein Werkzeugaufruf „write“ (Dateiänderung) mit Abschluss
//   [[toolfail]]  eine Dateiänderung, die vom Safe-Modus verweigert wurde (turn.failed)
//   [[fail]]      ein Fehler-Ereignis (Anmeldung)
//   [[fail429]]   ein Fehler-Ereignis (zu viele Anfragen)
//   [[slow]]      schreibt etwas und wartet dann (bis zum Abbruch)
//   [[huge]]      schreibt eine riesige Zeile
//   [[crash]]     beendet sich ohne Fehler-Ereignis mit Exit-Code 2
//   [[silent]]    beendet sich, ohne etwas zu schreiben
//   [[nachricht]] als Argument: das Programm würde hier fehlschlagen (Auftrag gehört auf stdin)
import { appendFileSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);

if (argv.includes('--version')) {
  if (process.env.FAKE_CODEX_BROKEN) {
    process.stderr.write('kaputt\n');
    process.exit(127);
  }
  process.stdout.write(`${process.env.FAKE_CODEX_VERSION ?? '9.9.9'}\n`);
  process.exit(0);
}

// Der Auftrag kommt über stdin (`codex exec -`), nie als Argument.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const prompt = Buffer.concat(chunks).toString('utf8');

if (process.env.FAKE_CODEX_LOG) {
  // Aufzeichnung für Tests: Argumente, Umgebung, Arbeitsordner, Auftrag, Konfigurations-Aufrufe.
  appendFileSync(
    process.env.FAKE_CODEX_LOG,
    `${JSON.stringify({
      argv,
      env: process.env,
      cwd: process.cwd(),
      prompt,
      config: readIfPresent(
        process.env.CODEX_HOME ? `${process.env.CODEX_HOME}/config.toml` : null,
      ),
    })}\n`,
  );
}

function readIfPresent(path) {
  try {
    return path ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

const thread = '0199a213-81c0-7800-8aa1-bbab2a035a53';
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

if (argv.includes('[[nachricht]]')) {
  // Der Auftrag gehört auf stdin (`codex exec -`): Als Argument wäre er in der Prozessliste sichtbar.
  process.stderr.write('Unrecognized flag or missing message\n');
  process.exit(64);
}
if (prompt.includes('[[silent]]')) process.exit(0);
if (prompt.includes('[[crash]]')) {
  process.stderr.write('Absturz\n');
  process.exit(2);
}
if (prompt.includes('[[slow]]')) {
  out({ type: 'thread.started', thread_id: thread });
  out({ type: 'turn.started' });
  out({
    type: 'item.completed',
    item: { id: 'item_1', type: 'agent_message', text: 'Ich arbeite …' },
  });
  // Ignoriert SIGINT nicht: Der erste Schritt der Stufen beendet den Lauf.
  await new Promise((resolve) => setTimeout(resolve, 120_000));
  process.exit(0);
}
if (prompt.includes('[[huge]]')) {
  // process.exit() würde die Ausgabe an einer Pipe abschneiden: erst warten, bis alles raus ist.
  process.stdout.write(`${'x'.repeat(9 * 1024 * 1024)}\n`, () => process.exit(0));
  await new Promise((resolve) => setTimeout(resolve, 60_000));
}

const usage = { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 };

out({ type: 'thread.started', thread_id: thread });
out({ type: 'turn.started' });

if (prompt.includes('[[fail]]') || prompt.includes('[[fail429]]')) {
  out({
    type: 'item.completed',
    item: { id: 'item_1', type: 'agent_message', text: 'Ich versuche es …' },
  });
  out({
    type: 'error',
    message: prompt.includes('[[fail]]')
      ? 'Fehler des Programms — nie weitergeben: nicht angemeldet'
      : 'Fehler des Programms — nie weitergeben: zu viele Anfragen',
  });
  out({ type: 'turn.failed', error: { message: 'Fehler des Programms — nie weitergeben' } });
  process.exit(1);
}
if (prompt.includes('[[toolfail]]')) {
  out({
    type: 'item.started',
    item: { id: 'item_2', type: 'file_change', status: 'in_progress', changes: ['ergebnis.txt'] },
  });
  out({
    type: 'item.completed',
    item: {
      id: 'item_2',
      type: 'file_change',
      status: 'failed',
      changes: ['ergebnis.txt'],
    },
  });
  out({
    type: 'turn.failed',
    error: {
      message: 'Geschrieben wurde nichts: durch den Safe-Modus verweigert (nur Anzahl zählt).',
    },
  });
  process.exit(0);
}
if (prompt.includes('[[write]]')) {
  out({
    type: 'item.completed',
    item: {
      id: 'item_w1',
      type: 'file_change',
      status: 'completed',
      changes: ['test/ergebnis.txt'],
    },
  });
  out({
    type: 'item.completed',
    item: { id: 'item_w2', type: 'agent_message', text: 'Fertig.' },
  });
  out({ type: 'turn.completed', usage });
  process.exit(0);
}

// Normalfall: zwei wachsende agent_message-Blöcke desselben Texts, dann Ende.
out({
  type: 'item.completed',
  item: { id: 'item_1', type: 'agent_message', text: 'Antwort:' },
});
out({
  type: 'item.completed',
  item: { id: 'item_1', type: 'agent_message', text: 'Antwort: hallo' },
});
out({ type: 'turn.completed', usage });
process.exit(0);
