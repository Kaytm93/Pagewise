import {
  parseServerMessage,
  type ServerCommand,
  type ServerMessage,
  type StartFailureKind,
  type StatusValue,
} from '@pagewise/server/control';
import { messages as m } from './i18n';

/** Der Kindprozess aus Sicht des Überwachers. Im Betrieb ist es ein Electron-`utilityProcess`, in Tests ein Ersatz. */
export interface ChildHandle {
  postMessage(message: unknown): void;
  kill(): boolean;
  onMessage(handler: (data: unknown) => void): void;
  onExit(handler: (code: number | null) => void): void;
}

export type SupervisorState = 'stopped' | 'starting' | 'running' | 'restarting' | 'failed';

export interface SupervisorFailure {
  kind: StartFailureKind | 'crash_loop' | 'start_timeout';
  /** Deutscher Text für Menschen, nie mit Secrets. */
  message: string;
}

export interface SupervisorSnapshot {
  state: SupervisorState;
  port: number | null;
  failure: SupervisorFailure | null;
  /** Wie oft der Server seit dem letzten manuellen Start neu gestartet wurde. */
  restarts: number;
}

export interface SupervisorOptions {
  spawn: () => ChildHandle;
  /** Fragt `/api/health` des laufenden Servers. */
  probe: () => Promise<boolean>;
  /** Pausen vor dem n-ten Neustart in einer Serie (Millisekunden). */
  backoffMs?: readonly number[];
  /** Nach so vielen Abstürzen innerhalb des Fensters gibt der Überwacher auf. */
  maxCrashes?: number;
  crashWindowMs?: number;
  startTimeoutMs?: number;
  healthIntervalMs?: number;
  /** So viele fehlgeschlagene Proben hintereinander gelten als hängender Server. */
  healthFailuresToRestart?: number;
  commandTimeoutMs?: number;
  now?: () => number;
}

export const DEFAULT_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;

/** Fehler, nach denen ein Neustart nichts ändert (Port belegt, zweiter Server, kaputte Konfiguration): nicht wiederholen. */
const PERMANENT: ReadonlySet<StartFailureKind> = new Set([
  'port_in_use',
  'instance_running',
  'config',
  'data_dir',
  'database',
]);

type Pending = {
  resolve: (value: ServerMessage & { type: 'reply' }) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Überwacht den Server: startet ihn, wartet auf `ready`, prüft regelmäßig `/api/health`, startet ihn nach einem
 * Absturz mit wachsender Pause neu (nach fünf Abstürzen innerhalb einer Minute ist Schluss, mit Fehlermeldung statt
 * Dauerschleife) und beendet ihn mit Zeitlimit, damit kein verwaister Kindprozess zurückbleibt.
 */
export class ServerSupervisor {
  private snapshot: SupervisorSnapshot = {
    state: 'stopped',
    port: null,
    failure: null,
    restarts: 0,
  };
  private readonly listeners = new Set<(snapshot: SupervisorSnapshot) => void>();
  private child: ChildHandle | null = null;
  private generation = 0;
  private crashes: number[] = [];
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private healthFailures = 0;
  private stopping = false;
  /** Fehler, den das Kind vor dem Austritt gemeldet hat (wird beim Austritt ausgewertet). */
  private pendingFailure: SupervisorFailure | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private exitWaiters: Array<() => void> = [];

  private readonly backoffMs: readonly number[];
  private readonly maxCrashes: number;
  private readonly crashWindowMs: number;
  private readonly startTimeoutMs: number;
  private readonly healthIntervalMs: number;
  private readonly healthFailuresToRestart: number;
  private readonly commandTimeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly options: SupervisorOptions) {
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.maxCrashes = options.maxCrashes ?? 5;
    this.crashWindowMs = options.crashWindowMs ?? 60_000;
    this.startTimeoutMs = options.startTimeoutMs ?? 20_000;
    this.healthIntervalMs = options.healthIntervalMs ?? 15_000;
    this.healthFailuresToRestart = options.healthFailuresToRestart ?? 3;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 5_000;
    this.now = options.now ?? Date.now;
  }

  getSnapshot(): SupervisorSnapshot {
    return this.snapshot;
  }

  onChange(listener: (snapshot: SupervisorSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<SupervisorSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  /** Startet den Server (nach einem Fehler oder Stopp ein frischer Versuch mit leerer Absturzliste). */
  start(): void {
    if (this.child || this.restartTimer) return;
    this.stopping = false;
    this.crashes = [];
    this.launch('starting', true);
  }

  private launch(state: 'starting' | 'restarting', fresh = false): void {
    const generation = ++this.generation;
    this.set({ state, port: null, ...(fresh ? { restarts: 0, failure: null } : {}) });
    this.healthFailures = 0;
    let child: ChildHandle;
    try {
      child = this.options.spawn();
    } catch {
      this.fail({ kind: 'other', message: m.failures.unexpected });
      return;
    }
    this.child = child;
    child.onMessage((data) => {
      if (generation === this.generation) this.handleMessage(data);
    });
    child.onExit((code) => {
      if (generation === this.generation) this.handleExit(code);
    });
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      if (generation !== this.generation || this.snapshot.state === 'running') return;
      // Der Server meldet sich nicht: beenden und wie einen Absturz behandeln.
      this.recordFailure({ kind: 'start_timeout', message: m.failures.startTimeout });
      child.kill();
    }, this.startTimeoutMs);
  }

  private recordFailure(failure: SupervisorFailure): void {
    this.pendingFailure = failure;
  }

  private handleMessage(data: unknown): void {
    const message = parseServerMessage(data);
    if (!message) return;
    if (message.type === 'ready') {
      this.clearStartTimer();
      this.set({ state: 'running', port: message.port, failure: null });
      this.startHealthChecks();
    } else if (message.type === 'failed') {
      this.clearStartTimer();
      this.recordFailure({ kind: message.kind, message: message.message });
    } else if (message.type === 'reply') {
      const entry = this.pending.get(message.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(message.id);
        entry.resolve(message);
      }
    }
    // `stopped` ist nur eine Meldung vor dem Ende, die Auswertung macht der Austritt des Prozesses.
  }

  private handleExit(_code: number | null): void {
    this.child = null;
    this.stopHealthChecks();
    this.clearStartTimer();
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve({ id, type: 'reply', ok: false, error: 'exited' });
    }
    const waiters = this.exitWaiters;
    this.exitWaiters = [];
    for (const wake of waiters) wake();

    if (this.stopping) {
      this.set({ state: 'stopped', port: null });
      return;
    }
    const failure = this.pendingFailure;
    this.pendingFailure = null;
    if (
      failure &&
      failure.kind !== 'other' &&
      failure.kind !== 'start_timeout' &&
      PERMANENT.has(failure.kind as StartFailureKind)
    ) {
      this.fail(failure);
      return;
    }
    this.crashed(failure);
  }

  /** Ein Absturz (oder Startfehler, der nicht dauerhaft ist): neu starten oder aufgeben. */
  private crashed(failure: SupervisorFailure | null): void {
    const now = this.now();
    this.crashes = [...this.crashes.filter((t) => now - t < this.crashWindowMs), now];
    if (this.crashes.length >= this.maxCrashes) {
      this.fail({ kind: 'crash_loop', message: m.failures.crashLoop });
      return;
    }
    const delay =
      this.backoffMs[Math.min(this.crashes.length - 1, this.backoffMs.length - 1)] ?? 8_000;
    this.set({
      state: 'restarting',
      port: null,
      failure: failure ?? null,
      restarts: this.snapshot.restarts + 1,
    });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopping) this.launch('restarting');
    }, delay);
  }

  private fail(failure: SupervisorFailure): void {
    this.set({ state: 'failed', port: null, failure });
  }

  private startHealthChecks(): void {
    this.stopHealthChecks();
    const generation = this.generation;
    this.healthTimer = setInterval(() => {
      void this.options.probe().then(
        (ok) => this.onProbe(generation, ok),
        () => this.onProbe(generation, false),
      );
    }, this.healthIntervalMs);
  }

  private onProbe(generation: number, ok: boolean): void {
    if (generation !== this.generation || this.snapshot.state !== 'running') return;
    this.healthFailures = ok ? 0 : this.healthFailures + 1;
    if (this.healthFailures >= this.healthFailuresToRestart) {
      // Der Prozess lebt, antwortet aber nicht: beenden, der Austritt löst den Neustart aus.
      this.healthFailures = 0;
      this.child?.kill();
    }
  }

  private stopHealthChecks(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  private clearStartTimer(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  /** Schickt einen Befehl über den Steuerkanal und wartet auf die Antwort (Zeitlimit: `commandTimeoutMs`). */
  request(
    type: ServerCommand['type'],
    timeoutMs = this.commandTimeoutMs,
  ): Promise<ServerMessage & { type: 'reply' }> {
    const child = this.child;
    const id = this.nextId++;
    if (!child) return Promise.resolve({ id, type: 'reply', ok: false, error: 'not_running' });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ id, type: 'reply', ok: false, error: 'timeout' });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      child.postMessage({ id, type });
    });
  }

  /** Aktueller Stand aus dem Server (laufende Antworten, Anmeldungen), `null`, wenn er nicht antwortet. */
  async serverStatus(): Promise<StatusValue | null> {
    const reply = await this.request('status');
    return reply.ok && reply.value && 'activeChats' in reply.value ? reply.value : null;
  }

  /** Einrichtungscode, solange Pagewise noch nicht eingerichtet ist. */
  async setupCode(): Promise<string | null> {
    const reply = await this.request('setup-code');
    return reply.ok && reply.value && 'code' in reply.value ? reply.value.code : null;
  }

  /** Setzt Passcode und Anmeldungen zurück (der Server startet dabei selbst neu). Gibt zurück, ob es gelang. */
  async resetPasscode(): Promise<boolean> {
    const reply = await this.request('reset-passcode', 30_000);
    return reply.ok;
  }

  /** Beendet den Server: zuerst höflich über den Kanal, nach dem Zeitlimit mit `kill`. */
  async stop(timeoutMs = 8_000): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.clearStartTimer();
    this.stopHealthChecks();
    const child = this.child;
    if (!child) {
      this.set({ state: this.snapshot.state === 'failed' ? 'failed' : 'stopped', port: null });
      return;
    }
    const exited = new Promise<void>((resolve) => this.exitWaiters.push(resolve));
    child.postMessage({ id: this.nextId++, type: 'stop' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const outcome = await Promise.race([exited.then(() => 'exited' as const), timedOut]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      child.kill();
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
    }
  }

  /** Neustart auf Wunsch (Menü „Server neu starten“): erst beenden, dann frisch starten. */
  async restart(): Promise<void> {
    await this.stop();
    this.child = null;
    this.start();
  }
}
