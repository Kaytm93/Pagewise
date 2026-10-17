import { spawn } from 'node:child_process';
import { setPriority } from 'node:os';

/**
 * Startet ein Programm für das Update: ohne Shell (`spawn` mit Argumentliste), mit eigener Umgebung, in einer eigenen
 * Prozessgruppe, damit ein Abbruch auch alles trifft, was pnpm und Co. darunter starten. Die Ausgabe kommt zeilenweise
 * zurück (ohne Steuerzeichen und Farben) und wird nie als Befehl oder Markup behandelt.
 */
export interface RunOptions {
  cwd?: string;
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
}

export interface RunResult {
  /** Exit-Code, `null`, wenn beendet durch Signal oder gar nicht gestartet. */
  code: number | null;
  /** Das Programm ließ sich nicht starten (fehlt, keine Rechte). */
  spawnFailed: boolean;
  timedOut: boolean;
  aborted: boolean;
  /** Die letzten Ausgabezeilen (für Fehlermeldungen und Entscheidungen), höchstens {@link TAIL_LINES}. */
  tail: string[];
}

export type Runner = (
  command: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<RunResult>;

export const TAIL_LINES = 60;
const MAX_LINE = 400;
/** Nach dem sanften Beenden so lange warten, dann hart beenden. */
const KILL_GRACE_MS = 4_000;
/** pnpm und Co. laufen mit niedriger Priorität, damit Pagewise während des Bauens bedienbar bleibt. */
const NICE = 10;

const ESCAPES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen aus der Ausgabe fremder Programme entfernen.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Macht aus einem Stück Ausgabe saubere Zeilen: ohne Farbcodes, Steuerzeichen und überlange Zeilen. */
export function cleanLine(raw: string): string {
  const line = raw.replace(ESCAPES, '').replace(CONTROL, '').trimEnd();
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)} …` : line;
}

/** Zerlegt Ausgabe in Zeilen; der Rest ohne Zeilenende bleibt für das nächste Stück liegen. */
export class LineSplitter {
  private rest = '';

  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split(/\r\n|\n|\r/);
    this.rest = parts.pop() ?? '';
    return parts.map(cleanLine).filter((line) => line !== '');
  }

  flush(): string[] {
    const line = cleanLine(this.rest);
    this.rest = '';
    return line === '' ? [] : [line];
  }
}

export function spawnRunner(): Runner {
  return (command, args, options) =>
    new Promise<RunResult>((resolve) => {
      const tail: string[] = [];
      const result: RunResult = {
        code: null,
        spawnFailed: false,
        timedOut: false,
        aborted: false,
        tail,
      };
      const emit = (lines: string[]): void => {
        for (const line of lines) {
          tail.push(line);
          if (tail.length > TAIL_LINES) tail.shift();
          options.onLine?.(line);
        }
      };

      if (options.signal?.aborted) {
        result.aborted = true;
        resolve(result);
        return;
      }

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command, [...args], {
          cwd: options.cwd,
          env: { ...options.env },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
          windowsHide: true,
        });
      } catch {
        result.spawnFailed = true;
        resolve(result);
        return;
      }

      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearTimeout(killTimer);
        options.signal?.removeEventListener('abort', onAbort);
        emit(out.flush());
        emit(err.flush());
        resolve(result);
      };

      /** Beendet die ganze Prozessgruppe: erst sanft, dann hart. */
      const terminate = (): void => {
        const pid = child.pid;
        if (pid === undefined) return;
        const send = (signal: NodeJS.Signals): void => {
          try {
            process.kill(-pid, signal);
          } catch {
            try {
              child.kill(signal);
            } catch {
              // schon beendet
            }
          }
        };
        send('SIGTERM');
        killTimer = setTimeout(() => send('SIGKILL'), KILL_GRACE_MS);
        killTimer.unref();
      };

      const onAbort = (): void => {
        result.aborted = true;
        terminate();
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const timeout = setTimeout(() => {
        result.timedOut = true;
        terminate();
      }, options.timeoutMs);
      timeout.unref();

      const out = new LineSplitter();
      const err = new LineSplitter();
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => emit(out.push(chunk)));
      child.stderr?.on('data', (chunk: string) => emit(err.push(chunk)));
      child.once('error', () => {
        result.spawnFailed = true;
        finish();
      });
      child.once('close', (code) => {
        result.code = code;
        finish();
      });

      if (child.pid !== undefined) {
        try {
          setPriority(child.pid, NICE);
        } catch {
          // Priorität ist Komfort.
        }
      }
    });
}
