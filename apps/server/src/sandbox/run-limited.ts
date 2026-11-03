import { execFile, spawn } from 'node:child_process';
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Startet ein Programm mit Grenzen: Laufzeit, Ausgabe, Speicher und Größe eines Ordners. Das Programm läuft in
 * einer eigenen Prozessgruppe, „Abbrechen“ und jede überschrittene Grenze beenden die ganze Gruppe (erst
 * SIGTERM, nach der Gnadenfrist SIGKILL). Es gibt keine Shell: Programm und Argumente gehen direkt an `spawn`,
 * die Umgebung wird vollständig vorgegeben.
 *
 * Warum ein Wächter? macOS setzt `ulimit -v` und `RLIMIT_AS` nicht durch (gemessen: `setrlimit failed`, 1,5 GB
 * ließen sich trotz 512-MB-Grenze belegen). Der Wächter fragt darum regelmäßig den Speicher des Prozesses und die
 * Größe des Arbeitsordners ab. Ein Überschreiten kann deshalb kurz andauern (Intervall, Schreibgeschwindigkeit);
 * die Grenzen sind Schutz vor Unfällen, nicht vor Absicht. Gegen Absicht schützt das Sandbox-Profil.
 *
 * Sicherheitsregeln: Ausgabe des Programms ist Fremdtext. Sie wird nur begrenzt im Speicher gehalten und nie
 * geloggt.
 */

export interface LimitedSpec {
  command: string;
  args: readonly string[];
  cwd: string;
  /** Die gesamte Umgebung. Nichts wird aus dem Server übernommen. */
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  /** Höchste Ausgabe insgesamt (stdout und stderr). Mehr beendet den Lauf. */
  maxOutputBytes: number;
  /** Höchster Speicher (RSS) des Prozesses. */
  maxMemoryBytes: number;
  /** Ordner, dessen Größe und Zahl der Einträge überwacht werden. */
  watchDir?: string;
  maxDirBytes?: number;
  maxDirEntries?: number;
  /** Wartezeit zwischen SIGTERM und SIGKILL. */
  killGraceMs?: number;
  /** Abstand der Wächter-Prüfungen. */
  watchIntervalMs?: number;
  /** Davon bleiben im Ergebnis erhalten: Anfang von stdout, Ende von stderr. */
  keepBytes?: number;
  signal?: AbortSignal;
}

export type LimitedEnd =
  | 'exit'
  | 'timeout'
  | 'cancelled'
  | 'output_limit'
  | 'memory_limit'
  | 'disk_limit'
  | 'spawn_failed';

export interface LimitedResult {
  reason: LimitedEnd;
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Anfang von stdout (höchstens `keepBytes`). */
  stdout: string;
  /** Ende von stderr (höchstens `keepBytes`). */
  stderr: string;
  outputTruncated: boolean;
  durationMs: number;
}

const DEFAULT_KEEP_BYTES = 16 * 1024;
const DEFAULT_WATCH_MS = 250;

/** Größe und Zahl der Einträge eines Ordners (ohne Verknüpfungen zu folgen). Bricht bei `maxEntries` ab. */
export function treeStats(dir: string, maxEntries: number): { bytes: number; entries: number } {
  let bytes = 0;
  let entries = 0;
  const walk = (current: string, depth: number): void => {
    if (entries > maxEntries || depth > 12) return;
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      return;
    }
    for (const name of names) {
      entries += 1;
      if (entries > maxEntries) return;
      const full = join(current, name);
      try {
        const stat = lstatSync(full);
        if (stat.isDirectory()) walk(full, depth + 1);
        else bytes += stat.size;
      } catch {
        // Eine Datei, die gerade verschwindet, zählt nicht.
      }
    }
  };
  walk(dir, 0);
  return { bytes, entries };
}

/** Speicher (RSS) eines Prozesses in Bytes, `null` wenn er nicht mehr läuft oder `ps` nichts liefert. */
function residentBytes(pid: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 2_000 }, (error, stdout) => {
      if (error) return resolve(null);
      const kilobytes = Number.parseInt(stdout.trim(), 10);
      resolve(Number.isFinite(kilobytes) ? kilobytes * 1024 : null);
    });
  });
}

export function runLimited(spec: LimitedSpec): Promise<LimitedResult> {
  const startedAt = Date.now();
  const keep = spec.keepBytes ?? DEFAULT_KEEP_BYTES;
  const finish = (partial: Partial<LimitedResult> & Pick<LimitedResult, 'reason'>) => ({
    code: null,
    signal: null,
    stdout: '',
    stderr: '',
    outputTruncated: false,
    durationMs: Date.now() - startedAt,
    ...partial,
  });
  if (spec.signal?.aborted) return Promise.resolve(finish({ reason: 'cancelled' }));

  return new Promise<LimitedResult>((resolve) => {
    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: { ...spec.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Eigene Prozessgruppe: Beenden erreicht alles, was das Programm gestartet hat.
      detached: true,
      windowsHide: true,
    });

    let reason: LimitedEnd = 'exit';
    let exited = false;
    let terminating = false;
    let total = 0;
    let truncated = false;
    const outChunks: Buffer[] = [];
    let outSize = 0;
    const errChunks: Buffer[] = [];
    let errSize = 0;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let watchTimer: ReturnType<typeof setInterval> | undefined;
    let watching = false;

    const signalGroup = (signal: NodeJS.Signals) => {
      const pid = child.pid;
      if (pid === undefined) return;
      try {
        process.kill(-pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // Schon beendet.
        }
      }
    };

    const terminate = (why: LimitedEnd) => {
      // Nach dem Ende gibt es nichts mehr zu beenden, und die Prozessnummer könnte neu vergeben sein.
      if (terminating || exited) return;
      terminating = true;
      reason = why;
      signalGroup('SIGTERM');
      killTimer = setTimeout(() => signalGroup('SIGKILL'), spec.killGraceMs ?? 1_000);
    };

    const onAbort = () => terminate('cancelled');
    spec.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => terminate('timeout'), spec.timeoutMs);

    const count = (chunk: Buffer): boolean => {
      total += chunk.length;
      if (total > spec.maxOutputBytes) {
        truncated = true;
        terminate('output_limit');
        return false;
      }
      return true;
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (!count(chunk)) return;
      if (outSize < keep) {
        const take = chunk.subarray(0, keep - outSize);
        outChunks.push(take);
        outSize += take.length;
        if (take.length < chunk.length) truncated = true;
      } else {
        truncated = true;
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (!count(chunk)) return;
      errChunks.push(chunk);
      errSize += chunk.length;
      while (errSize > keep && errChunks.length > 0) {
        const first = errChunks[0] as Buffer;
        if (errSize - first.length >= keep) {
          errChunks.shift();
          errSize -= first.length;
        } else {
          errChunks[0] = first.subarray(errSize - keep);
          errSize = keep;
          truncated = true;
        }
      }
    });

    const watch = async () => {
      if (watching || terminating || exited || child.pid === undefined) return;
      watching = true;
      try {
        const memory = await residentBytes(child.pid);
        if (memory !== null && memory > spec.maxMemoryBytes) return terminate('memory_limit');
        if (spec.watchDir) {
          const stats = treeStats(spec.watchDir, spec.maxDirEntries ?? 20_000);
          if (
            stats.bytes > (spec.maxDirBytes ?? Number.POSITIVE_INFINITY) ||
            stats.entries > (spec.maxDirEntries ?? 20_000)
          ) {
            terminate('disk_limit');
          }
        }
      } finally {
        watching = false;
      }
    };
    watchTimer = setInterval(() => void watch(), spec.watchIntervalMs ?? DEFAULT_WATCH_MS);

    let settled = false;
    const settle = (result: LimitedResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearInterval(watchTimer);
      spec.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    child.once('error', () => {
      exited = true;
      settle(finish({ reason: 'spawn_failed' }));
    });
    child.once('close', (code, signal) => {
      exited = true;
      settle(
        finish({
          reason,
          code,
          signal,
          stdout: Buffer.concat(outChunks).toString('utf8'),
          stderr: Buffer.concat(errChunks).toString('utf8'),
          outputTruncated: truncated,
        }),
      );
    });
  });
}
