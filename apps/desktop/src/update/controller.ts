import type {
  CheckResult,
  InstalledInfo,
  PrepareHooks,
  StepId,
  UpdateErrorCode,
  UpdateResult,
  UpdateService,
} from './service';
import { UpdateError } from './service';
import {
  buildUpdateView,
  LOG_LINES_SHOWN,
  type Stage,
  type UpdateState,
  type UpdateView,
} from './view';

/** Die Teile des Dienstes, die der Controller braucht (so lassen sie sich im Test ersetzen). */
export type UpdateServiceLike = Pick<
  UpdateService,
  | 'support'
  | 'installed'
  | 'check'
  | 'prepare'
  | 'loadReady'
  | 'handoff'
  | 'readResult'
  | 'clearResult'
> & { readonly paths: { log: string } };

export interface HandoffSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface UpdateControllerDeps {
  service: UpdateServiceLike;
  settings: { autoCheck(): boolean; setAutoCheck(enabled: boolean): void };
  /** Laufende Antworten und Anmeldungen, `null`, wenn der Server nicht antwortet (für die Rückfrage). */
  runningStatus(): Promise<{ activeChats: number; sessions: number } | null>;
  /** Fragt vor dem Neustart nach. `true` heißt: weiter. */
  confirmRestart(status: { activeChats: number; sessions: number } | null): Promise<boolean>;
  /** Startet den Helfer losgelöst von der App. Wirft, wenn er sich nicht starten lässt. */
  spawnDetached(spec: HandoffSpec): Promise<void>;
  /** Beendet die App (ohne weitere Rückfrage; die Rückfrage war `confirmRestart`). */
  quit(): void;
  revealLog(path: string): void;
  pid: number;
  now?: () => Date;
  /** Der Zustand hat sich geändert (Menüs, Menüleisten-Symbol). */
  changed?: () => void;
}

/** Wie viele Zeilen der Ausgabe im Speicher bleiben. */
const KEEP_LINES = 200;

/**
 * Der Zustand des Updates und seine Übergänge. Es läuft höchstens eine Sache zugleich (Nachsehen oder Vorbereiten);
 * jede Aktion prüft den Zustand, bevor sie etwas tut, und lässt sich nicht doppelt auslösen. Die Seite sieht nur die
 * fertige {@link UpdateView}.
 */
export class UpdateController {
  private state: UpdateState;
  private abort: AbortController | null = null;
  private restarting = false;
  private readonly now: () => Date;

  constructor(private readonly deps: UpdateControllerDeps) {
    this.now = deps.now ?? (() => new Date());
    const support = deps.service.support();
    this.state = {
      stage: support.ok ? 'idle' : 'unsupported',
      unsupported: support.ok ? null : support.reason,
      remote: null,
      changes: [],
      changeCount: null,
      step: null,
      lines: [],
      error: null,
      checkedAt: null,
      ready: null,
      message: null,
    };
    // Eine früher vorbereitete Fassung, die noch bereitliegt, ist sofort wieder einsetzbar.
    const ready = support.ok ? deps.service.loadReady() : null;
    if (ready) {
      this.state.ready = ready;
      this.state.remote = { commit: ready.commit, date: ready.commitDate };
      this.state.stage = 'ready';
    }
  }

  get stage(): Stage {
    return this.state.stage;
  }

  /** Gibt es etwas Neues (gefunden oder schon bereit)? Für die Menüs. */
  get updatePending(): boolean {
    return this.state.stage === 'available' || this.state.stage === 'ready';
  }

  installed(): InstalledInfo {
    return this.deps.service.installed();
  }

  getView(): UpdateView {
    return buildUpdateView(this.state, {
      installed: this.deps.service.installed(),
      autoCheck: this.deps.settings.autoCheck(),
    });
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.deps.changed?.();
  }

  private busy(): boolean {
    return this.state.stage === 'checking' || this.state.stage === 'working' || this.restarting;
  }

  /** Das Ergebnis des letzten Austauschs (einmal lesen, dann löschen), z. B. für die Meldung nach dem Neustart. */
  consumeResult(): UpdateResult | null {
    const result = this.deps.service.readResult();
    if (result) this.deps.service.clearResult();
    return result;
  }

  // --- Nachsehen ---------------------------------------------------------------------------------

  /** Fragt bei GitHub nach. `auto`: Fehler bleiben still (kein Netz beim Start ist kein Grund zu stören). */
  async check(source: 'manual' | 'auto' = 'manual'): Promise<UpdateView> {
    if (this.busy() || this.state.stage === 'unsupported') return this.getView();
    const before = this.state.stage;
    this.set({ stage: 'checking', error: null, message: null });
    this.abort = new AbortController();
    try {
      const result = await this.deps.service.check(this.abort.signal);
      this.applyCheck(result);
    } catch (error) {
      if (source === 'auto') {
        this.set({ stage: before });
      } else {
        this.set({
          stage: 'failed',
          error: { code: errorCode(error), during: 'check' },
          lines: errorLines(error),
        });
      }
    } finally {
      this.abort = null;
    }
    return this.getView();
  }

  private applyCheck(result: CheckResult): void {
    const checkedAt = this.now();
    if (result.upToDate) {
      this.set({
        stage: 'up-to-date',
        remote: { commit: result.remote, date: result.remoteDate },
        changes: [],
        changeCount: 0,
        ready: null,
        checkedAt,
        lines: [],
      });
      return;
    }
    const ready = this.deps.service.loadReady(result.remote);
    this.set({
      stage: ready ? 'ready' : 'available',
      remote: { commit: result.remote, date: result.remoteDate },
      changes: result.changes,
      changeCount: result.changeCount,
      ready,
      checkedAt,
      lines: [],
    });
  }

  // --- Vorbereiten ---------------------------------------------------------------------------------

  async start(): Promise<UpdateView> {
    const { stage } = this.state;
    const retry = stage === 'failed' && this.state.error?.during === 'prepare';
    if (this.busy() || !(stage === 'available' || retry)) return this.getView();
    this.set({ stage: 'working', step: null, lines: [], error: null, message: null });
    this.abort = new AbortController();
    const hooks: PrepareHooks = {
      signal: this.abort.signal,
      step: (id: StepId) => this.set({ step: id }),
      line: (text) => {
        const lines = [...this.state.lines, text];
        this.state = { ...this.state, lines: lines.slice(-KEEP_LINES) };
      },
    };
    try {
      const ready = await this.deps.service.prepare(hooks);
      this.set({
        stage: 'ready',
        ready,
        remote: { commit: ready.commit, date: ready.commitDate },
        step: null,
        error: null,
      });
    } catch (error) {
      if (error instanceof UpdateError && error.code === 'cancelled') {
        this.set({
          stage: this.state.remote ? 'available' : 'idle',
          step: null,
          message: 'cancelled',
        });
      } else {
        this.set({
          stage: 'failed',
          error: { code: errorCode(error), during: 'prepare' },
        });
      }
    } finally {
      this.abort = null;
    }
    return this.getView();
  }

  cancel(): UpdateView {
    if (this.state.stage === 'working' || this.state.stage === 'checking') this.abort?.abort();
    return this.getView();
  }

  // --- Einsetzen ---------------------------------------------------------------------------------

  /** Fragt nach, startet den Helfer und beendet die App. Danach setzt der Helfer die neue Fassung ein. */
  async restart(): Promise<UpdateView> {
    const ready = this.state.ready;
    if (this.state.stage !== 'ready' || !ready || this.busy()) return this.getView();
    this.restarting = true;
    try {
      // Die Fassung kann inzwischen weg sein (Cache aufgeräumt): dann nichts beenden.
      if (!this.deps.service.loadReady(ready.commit)) {
        this.set({ stage: 'failed', error: { code: 'not-ready', during: 'prepare' }, ready: null });
        return this.getView();
      }
      const confirmed = await this.deps.confirmRestart(await this.deps.runningStatus());
      if (!confirmed) return this.getView();
      let spec: HandoffSpec;
      try {
        spec = this.deps.service.handoff(ready, this.deps.pid);
        await this.deps.spawnDetached(spec);
      } catch (error) {
        this.set({
          stage: 'failed',
          error: {
            code: error instanceof UpdateError ? error.code : 'handoff-failed',
            during: 'prepare',
          },
        });
        return this.getView();
      }
      this.set({ message: 'restarting' });
      this.deps.quit();
      return this.getView();
    } finally {
      this.restarting = false;
    }
  }

  // --- Sonstiges ---------------------------------------------------------------------------------

  setAutoCheck(enabled: boolean): UpdateView {
    this.deps.settings.setAutoCheck(enabled === true);
    return this.getView();
  }

  showLog(): void {
    this.deps.revealLog(this.deps.service.paths.log);
  }
}

function errorCode(error: unknown): UpdateErrorCode {
  return error instanceof UpdateError ? error.code : 'git-failed';
}

/** Die letzten Zeilen eines Fehlers, dessen Ausgabe nicht mitgelaufen ist (Nachsehen). */
function errorLines(error: unknown): string[] {
  return error instanceof UpdateError ? [...error.detail].slice(-LOG_LINES_SHOWN) : [];
}
