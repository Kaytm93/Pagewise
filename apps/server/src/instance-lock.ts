import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sperre gegen einen zweiten Server auf demselben Datenverzeichnis. Zwei Prozesse auf einer SQLite-Datei (WAL) würden
 * sich zwar nicht die Datei zerstören, aber Antworten, Sitzungen und den Zähler der Fehlversuche je für sich führen
 * und gegenseitig Datenbank-Sicherungen und „Alles löschen“ stören. Deshalb gibt es genau einen.
 *
 * Die Sperre ist eine Datei mit der Prozessnummer. Sie wird atomar angelegt (`wx`). Gehört sie einem Prozess, den es
 * nicht mehr gibt (Absturz, Stromausfall), gilt sie als verwaist und wird übernommen.
 */

export const LOCK_FILE = 'server.lock';

export class InstanceLockError extends Error {
  constructor(
    message: string,
    /** Prozessnummer des laufenden Servers. */
    readonly pid: number,
    readonly lockFile: string,
  ) {
    super(message);
    this.name = 'InstanceLockError';
  }
}

export interface LockHolder {
  pid: number;
  startedAt: number;
  /** Port, sobald der Server lauscht. */
  port: number | null;
}

export interface InstanceLock {
  readonly file: string;
  /** Trägt den Port ein (für Hinweise an einen zweiten Start). */
  setPort(port: number): void;
  /** Gibt die Sperre frei, aber nur, wenn sie noch uns gehört. */
  release(): void;
}

export interface LockOptions {
  pid?: number;
  now?: () => number;
  /** Nur für Tests: ersetzt die Prüfung, ob ein Prozess noch lebt. */
  isAlive?: (pid: number) => boolean;
}

/** `process.kill(pid, 0)` sendet kein Signal, es prüft nur, ob es den Prozess gibt. */
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: den Prozess gibt es, er gehört nur jemand anderem.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readRaw(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function parseHolder(raw: string): LockHolder | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { pid, startedAt, port } = value as Record<string, unknown>;
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
    return {
      pid,
      startedAt: typeof startedAt === 'number' ? startedAt : 0,
      port: typeof port === 'number' && Number.isInteger(port) ? port : null,
    };
  } catch {
    return null;
  }
}

/** Wer die Sperre hält, falls es einen lebenden Inhaber gibt. Verwaiste Sperren zählen nicht. */
export function readLockHolder(
  dataDir: string,
  options: Pick<LockOptions, 'isAlive'> = {},
): LockHolder | null {
  const isAlive = options.isAlive ?? processIsAlive;
  let raw: string;
  try {
    raw = readFileSync(join(dataDir, LOCK_FILE), 'utf8');
  } catch {
    return null;
  }
  const holder = parseHolder(raw);
  return holder && isAlive(holder.pid) ? holder : null;
}

export function acquireInstanceLock(dataDir: string, options: LockOptions = {}): InstanceLock {
  const file = join(dataDir, LOCK_FILE);
  const pid = options.pid ?? process.pid;
  const now = options.now ?? Date.now;
  const isAlive = options.isAlive ?? processIsAlive;
  const startedAt = now();
  let port: number | null = null;
  const body = (): string => JSON.stringify({ pid, startedAt, port });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      try {
        writeFileSync(fd, body());
      } finally {
        closeSync(fd);
      }
      return {
        file,
        setPort(value) {
          port = value;
          try {
            writeFileSync(file, body(), { mode: 0o600 });
          } catch {
            // Die Sperre gilt auch ohne Port.
          }
        },
        release() {
          try {
            const holder = parseHolder(readFileSync(file, 'utf8'));
            if (holder?.pid === pid) rmSync(file, { force: true });
          } catch {
            // schon weg
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const seen = readRaw(file);
    const holder = readLockHolder(dataDir, { isAlive });
    if (holder) {
      throw new InstanceLockError(
        [
          'Pagewise läuft bereits mit diesem Datenverzeichnis.',
          `  Prozess: ${holder.pid}${holder.port ? `, Port ${holder.port}` : ''}`,
          'Zwei Server auf denselben Daten würden sich gegenseitig stören. Beende den anderen zuerst.',
          `Läuft in Wirklichkeit nichts, lösche die Datei ${file}.`,
        ].join('\n'),
        holder.pid,
        file,
      );
    }
    // Verwaist (der Prozess ist weg) oder unlesbar: entfernen und noch einmal versuchen. Entfernt wird nur,
    // was sich seit dem Lesen nicht verändert hat, damit eine eben erst von einem anderen Start angelegte
    // Sperre nicht gelöscht wird.
    if (readRaw(file) === seen) rmSync(file, { force: true });
  }
  throw new InstanceLockError(
    `Die Sperre ${file} ließ sich nicht übernehmen. Läuft Pagewise schon? Sonst lösche die Datei.`,
    0,
    file,
  );
}
