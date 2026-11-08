#!/usr/bin/env node
// Ersatz für das Programm „opencode“ (OpenCode) in Tests. Er erzeugt dieselbe Ausgabe im JSON-Format
// wie das echte Programm (gemessen mit opencode 2.0.29: `opencode run --standalone --format json`),
// kennt aber weder Netz noch Konten. Das Verhalten steuern Marker im Auftrag (stdin). Nur für Tests.
//
//   [[write]]     ein Werkzeugaufruf „write“ mit Ergebnis (kurze Datei-Eingabe, nie Inhalte)
//   [[toolfail]]  ein Werkzeugaufruf, der mit einem Berechtigungsfehler endet
//   [[fail]]      ein Fehler-Ereignis (Authentifizierung)
//   [[fail429]]   ein Fehler-Ereignis (zu viele Anfragen)
//   [[slow]]      schreibt etwas und wartet dann (bis zum Abbruch)
//   [[huge]]      schreibt eine riesige Zeile
//   [[crash]]     beendet sich ohne Fehler-Ereignis mit Exit-Code 2
//   [[silent]]    beendet sich, ohne etwas zu schreiben
//   [[nachricht]] als Argument: das Programm würde hier fehlschlagen (Auftrag gehört auf stdin)
import { appendFileSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);

if (argv.includes('--version')) {
  if (process.env.FAKE_OPENCODE_BROKEN) {
    process.stderr.write('kaputt\n');
    process.exit(127);
  }
  process.stdout.write(`${process.env.FAKE_OPENCODE_VERSION ?? '9.9.9'}\n`);
  process.exit(0);
}

const flag = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? null : (argv[index + 1] ?? null);
};

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const prompt = Buffer.concat(chunks).toString('utf8');

if (process.env.FAKE_OPENCODE_LOG) {
  // Aufzeichnung für Tests: Argumente, Umgebung, Arbeitsordner, Auftrag, Konfiguration.
  appendFileSync(
    process.env.FAKE_OPENCODE_LOG,
    `${JSON.stringify({
      argv,
      env: process.env,
      cwd: process.cwd(),
      prompt,
      config: readIfPresent(flag('--settings') ?? process.env.OPENCODE_CONFIG ?? null),
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

const session = flag('--session') ?? 'ses_beispiel0000000000000000000000';
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const stamp = () => 1_700_000_000_000;

if (argv.includes('[[nachricht]]')) {
  // Der Auftrag gehört auf stdin: Als Argument wäre er in der Prozessliste sichtbar.
  process.stderr.write('Unrecognized flag or missing message\n');
  process.exit(64);
}
if (prompt.includes('[[silent]]')) process.exit(0);
if (prompt.includes('[[crash]]')) {
  process.stderr.write('Absturz\n');
  process.exit(2);
}
if (prompt.includes('[[slow]]')) {
  out({ type: 'step_start', timestamp: stamp(), sessionID: session, part: { type: 'step-start' } });
  out({
    type: 'text',
    timestamp: stamp(),
    sessionID: session,
    part: { type: 'text', text: 'Ich arbeite …' },
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

const part = (extra) => ({ sessionID: session, messageID: 'msg_1', ...extra });
const toolState = (status, extra = {}) => ({
  status,
  input: { file_path: `${process.cwd()}/ergebnis.txt` },
  ...extra,
});

out({
  type: 'step_start',
  timestamp: stamp(),
  sessionID: session,
  part: part({ type: 'step-start' }),
});
if (prompt.includes('[[fail]]') || prompt.includes('[[fail429]]')) {
  out({
    type: 'text',
    timestamp: stamp(),
    sessionID: session,
    part: part({ type: 'text', text: 'Ich versuche es …' }),
  });
  out({
    type: 'error',
    timestamp: stamp(),
    sessionID: session,
    error: prompt.includes('[[fail]]')
      ? { type: 'provider.auth', message: 'Fehler des Programms — nie weitergeben' }
      : {
          type: 'provider.invalid-request',
          status: 429,
          message: 'Fehler des Programms — nie weitergeben',
        },
  });
  process.exit(1);
}
if (prompt.includes('[[toolfail]]')) {
  out({
    type: 'tool_use',
    timestamp: stamp(),
    sessionID: session,
    part: part({ type: 'tool', callID: 'call_1', tool: 'write', state: toolState('pending') }),
  });
  out({
    type: 'tool_use',
    timestamp: stamp(),
    sessionID: session,
    part: part({
      type: 'tool',
      callID: 'call_1',
      tool: 'write',
      state: toolState('error', { error: 'permission requested: write; auto-rejecting' }),
    }),
  });
  process.exit(0);
}
if (prompt.includes('[[write]]')) {
  out({
    type: 'text',
    timestamp: stamp(),
    sessionID: session,
    part: part({ type: 'text', text: 'Ich lege die Datei an. ' }),
  });
  out({
    type: 'tool_use',
    timestamp: stamp(),
    sessionID: session,
    part: part({
      type: 'tool',
      callID: 'call_w1',
      tool: 'write',
      state: toolState('running', { title: 'test/ergebnis.txt' }),
    }),
  });
  out({
    type: 'tool_use',
    timestamp: stamp(),
    sessionID: session,
    part: part({
      type: 'tool',
      callID: 'call_w1',
      tool: 'write',
      state: toolState('completed', { title: 'ergebnis.txt' }),
    }),
  });
  out({
    type: 'step_start',
    timestamp: stamp(),
    sessionID: session,
    part: part({ type: 'step-start' }),
  });
  out({
    type: 'text',
    timestamp: stamp(),
    sessionID: session,
    part: part({ type: 'text', text: 'Fertig.' }),
  });
  process.exit(0);
}

// Normalfall: zwei wachsende Textblöcke desselben Teils, dann Ende.
out({
  type: 'text',
  timestamp: stamp(),
  sessionID: session,
  part: part({ id: 'prt_1', type: 'text', text: 'Antwort:' }),
});
out({
  type: 'text',
  timestamp: stamp(),
  sessionID: session,
  part: part({ id: 'prt_1', type: 'text', text: 'Antwort: hallo' }),
});
process.exit(0);
