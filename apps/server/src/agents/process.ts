import { type ChildProcess, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

/**
 * Startet ein Programm als Subprozess und liefert seine Ausgabe zeilenweise. Alles, was bei Agenten
 * schiefgehen kann, ist hier begrenzt: Laufzeit, Gesamtausgabe, Länge einer Zeile. „Abbrechen“ beendet
 * die ganze Prozessgruppe (auch Kindprozesse, die der Agent gestartet hat), erst freundlich, dann hart.
 *
 * Sicherheitsregeln: Die Eingabe (Auftrag des Nutzers) geht über stdin, nie als Argument, damit sie nicht
 * in der Prozessliste steht. Die Umgebung wird vollständig vorgegeben (keine Übernahme von `process.env`).
 * Texte aus stderr bleiben im Speicher und werden nie weitergegeben (siehe `stderrTail`).
 */

export interface RunSpec {
  command: string;
  args: readonly string[];
  cwd: string;
  /** Die gesamte Umgebung des Prozesses. Nichts wird aus dem Server übernommen. */
  env: Readonly<Record<string, string>>;
  stdin: string;
  timeoutMs: number;
  /** Höchste Menge an Ausgabe (stdout) insgesamt. */
  maxOutputBytes: number;
  /** Längste einzelne Zeile. Eine längere Zeile bricht den Lauf ab. */
  maxLineBytes: number;
  /** Wartezeit zwischen zwei Stufen beim Beenden. */
  killGraceMs?: number;
  /**
   * Signale beim Beenden, in dieser Reihenfolge, jeweils nach `killGraceMs`. Standard: SIGTERM, dann SIGKILL.
   * Für Claude Code besser SIGINT zuerst: Das Programm beendet den Zug sauber und meldet ein Ergebnis.
   */
  escalation?: readonly NodeJS.Signals[];
}

export type EndReason = 'exit' | 'timeout' | 'cancelled' | 'output_limit' | 'spawn_failed';

export interface RunEnd {
  code: number | null;
  signal: NodeJS.Signals | null;
  reason: EndReason;
}

const STDERR_KEEP_BYTES = 16 * 1024;

export class ProcessRun {
  /** Die Zeilen von stdout. Ohne abschließenden Zeilenumbruch, leere Zeilen entfallen. */
  readonly lines: AsyncIterable<string>;
  /** Wird erfüllt, wenn der Prozess beendet und seine Ausgabe vollständig gelesen ist. */
  readonly ended: Promise<RunEnd>;

  private readonly child: ChildProcess;
  private readonly queue: string[] = [];
  private waiting: ((value: IteratorResult<string>) => void) | null = null;
  private closed = false;
  private stderrChunks: Buffer[] = [];
  private stderrSize = 0;
  private reason: EndReason = 'exit';
  private killTimer: ReturnType<typeof setTimeout> | undefined;
  private stage = 0;
  private hardTimer: ReturnType<typeof setTimeout> | undefined;
  private terminating = false;

  constructor(private readonly spec: RunSpec) {
    this.lines = { [Symbol.asyncIterator]: () => this.iterator() };
    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: { ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      // Eigene Prozessgruppe: „Abbrechen“ erreicht auch Kindprozesse des Agenten.
      detached: true,
      windowsHide: true,
    });
    this.child = child;

    this.ended = new Promise<RunEnd>((resolve) => {
      let spawnFailed = false;
      child.once('error', () => {
        spawnFailed = true;
        this.reason = 'spawn_failed';
        this.finishLines();
        resolve({ code: null, signal: null, reason: 'spawn_failed' });
      });
      child.once('close', (code, signal) => {
        clearTimeout(this.killTimer);
        clearTimeout(this.hardTimer);
        this.flushLine();
        this.finishLines();
        if (!spawnFailed) resolve({ code, signal, reason: this.reason });
      });
    });

    const decoder = new StringDecoder('utf8');
    let pending = '';
    let total = 0;
    child.stdout?.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > spec.maxOutputBytes) {
        this.terminate('output_limit');
        return;
      }
      pending += decoder.write(chunk);
      let index = pending.indexOf('\n');
      while (index !== -1) {
        this.push(pending.slice(0, index));
        pending = pending.slice(index + 1);
        index = pending.indexOf('\n');
      }
      if (Buffer.byteLength(pending) > spec.maxLineBytes) {
        pending = '';
        this.terminate('output_limit');
      }
      this.partial = pending;
    });
    child.stdout?.on('end', () => {
      pending += decoder.end();
      this.partial = pending;
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrChunks.push(chunk);
      this.stderrSize += chunk.length;
      while (this.stderrSize > STDERR_KEEP_BYTES && this.stderrChunks.length > 1) {
        this.stderrSize -= this.stderrChunks.shift()?.length ?? 0;
      }
    });

    // Der Auftrag geht nur über stdin. Bricht der Prozess vorher ab, ist ein EPIPE kein Fehler.
    child.stdin?.on('error', () => {});
    child.stdin?.end(spec.stdin);

    this.hardTimer = setTimeout(() => this.terminate('timeout'), spec.timeoutMs);
  }

  private partial = '';

  private push(line: string): void {
    if (line.trim() === '') return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: line, done: false });
    } else {
      this.queue.push(line);
    }
  }

  private flushLine(): void {
    if (this.partial.trim() !== '' && this.reason !== 'output_limit') this.push(this.partial);
    this.partial = '';
  }

  private finishLines(): void {
    this.closed = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  private iterator(): AsyncIterator<string> {
    return {
      next: (): Promise<IteratorResult<string>> => {
        const line = this.queue.shift();
        if (line !== undefined) return Promise.resolve({ value: line, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }

  /** Beendet den Lauf: Signale an die Prozessgruppe, jede Stufe erst nach der Gnadenfrist der vorigen. */
  private terminate(reason: EndReason): void {
    if (this.terminating) return;
    this.terminating = true;
    this.reason = reason;
    this.nextSignal();
  }

  private nextSignal(): void {
    const steps = this.spec.escalation ?? (['SIGTERM', 'SIGKILL'] as const);
    const signal = steps[this.stage];
    if (!signal) return;
    this.stage += 1;
    this.signalGroup(signal);
    if (this.stage < steps.length) {
      this.killTimer = setTimeout(() => this.nextSignal(), this.spec.killGraceMs ?? 3_000);
    }
  }

  private signalGroup(signal: NodeJS.Signals): void {
    const pid = this.child.pid;
    if (pid === undefined) return;
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        this.child.kill(signal);
      } catch {
        // Der Prozess ist schon beendet.
      }
    }
  }

  /** Vom Nutzer abgebrochen. */
  cancel(): void {
    this.terminate('cancelled');
  }

  /**
   * Die letzten Zeilen von stderr, nur für die Einordnung eines Fehlers (z. B. Fehlernummer erkennen).
   * Nie an den Nutzer oder in Logs weitergeben: Sie können Eingaben oder Zugangsdaten wiederholen.
   */
  stderrTail(): string {
    return Buffer.concat(this.stderrChunks).toString('utf8');
  }
}
