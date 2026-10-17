import { describe, expect, it, vi } from 'vitest';
import {
  type HandoffSpec,
  UpdateController,
  type UpdateControllerDeps,
  type UpdateServiceLike,
} from './controller';
import {
  type CheckResult,
  type PrepareHooks,
  type ReadyUpdate,
  type UnsupportedReason,
  UpdateError,
} from './service';
import { SHA_A, SHA_B } from './test-support';

const READY: ReadyUpdate = {
  commit: SHA_B,
  commitDate: '2026-10-16T09:00:00Z',
  appPath: '/cache/repo/app/Pagewise.app',
  builtAt: '2026-10-17T10:00:00Z',
};
const AVAILABLE: CheckResult = {
  remote: SHA_B,
  upToDate: false,
  changes: ['fix: Eins'],
  changeCount: 1,
  remoteDate: null,
};

type Status = { activeChats: number; sessions: number };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(
  options: {
    support?: { ok: true; bundle: string } | { ok: false; reason: UnsupportedReason };
    check?: UpdateServiceLike['check'];
    prepare?: UpdateServiceLike['prepare'];
    loadReady?: UpdateServiceLike['loadReady'];
    handoff?: UpdateServiceLike['handoff'];
    deps?: Partial<UpdateControllerDeps>;
  } = {},
) {
  let auto = false;
  const service: UpdateServiceLike = {
    paths: { log: '/cache/update.log' },
    support: () => options.support ?? { ok: true, bundle: '/Users/b/Applications/Pagewise.app' },
    installed: () => ({ commit: SHA_A, commitDate: null, builtAt: null, dirty: false }),
    check: options.check ?? (async () => AVAILABLE),
    prepare: options.prepare ?? (async () => READY),
    loadReady: options.loadReady ?? (() => null),
    handoff:
      options.handoff ??
      (() => ({ command: '/n/node', args: ['helfer.mjs'], env: { PATH: '/usr/bin' } })),
    readResult: () => null,
    clearResult: () => undefined,
  };
  const mocks = {
    runningStatus: vi.fn(async () => ({ activeChats: 1, sessions: 2 }) as Status | null),
    confirmRestart: vi.fn(async (_status: Status | null) => true),
    spawnDetached: vi.fn(async (_spec: HandoffSpec) => undefined),
    quit: vi.fn(),
    revealLog: vi.fn(),
    changed: vi.fn(),
  };
  const deps: UpdateControllerDeps = {
    service,
    settings: {
      autoCheck: () => auto,
      setAutoCheck: (v: boolean) => {
        auto = v;
      },
    },
    ...mocks,
    pid: 777,
    now: () => new Date('2026-10-17T12:00:00Z'),
    ...options.deps,
  };
  return { controller: new UpdateController(deps), deps: mocks };
}

describe('Update: Zustand und Übergänge', () => {
  it('startet bereit zum Prüfen, in einer Entwicklungsfassung aber „nicht möglich“', () => {
    expect(setup().controller.stage).toBe('idle');
    const dev = setup({ support: { ok: false, reason: 'dev' } }).controller;
    expect(dev.stage).toBe('unsupported');
    expect(dev.getView().actions).toEqual([]);
  });

  it('startet sofort mit „bereit“, wenn eine vorbereitete Fassung noch daliegt', () => {
    const { controller } = setup({ loadReady: () => READY });
    expect(controller.stage).toBe('ready');
    expect(controller.updatePending).toBe(true);
    expect(controller.getView().facts.map((f) => f.label)).toEqual(['Installiert', 'Neu']);
  });

  it('prüft und findet ein Update', async () => {
    const { controller, deps } = setup();
    const view = await controller.check();
    expect(view.stage).toBe('available');
    expect(view.changes?.items).toEqual(['fix: Eins']);
    expect(controller.updatePending).toBe(true);
    expect(deps.changed).toHaveBeenCalled();
  });

  it('zeigt während des Prüfens „checking“ und lässt kein zweites Prüfen zu', async () => {
    const gate = deferred<CheckResult>();
    const check = vi.fn(() => gate.promise);
    const { controller } = setup({ check });
    const first = controller.check();
    expect(controller.stage).toBe('checking');
    expect(controller.getView().busy).toBe(true);
    await controller.check();
    expect(check).toHaveBeenCalledTimes(1);
    gate.resolve({ ...AVAILABLE, upToDate: true });
    expect((await first).stage).toBe('up-to-date');
  });

  it('meldet „aktuell“ mit dem Zeitpunkt', async () => {
    const { controller } = setup({ check: async () => ({ ...AVAILABLE, upToDate: true }) });
    const view = await controller.check();
    expect(view.stage).toBe('up-to-date');
    expect(view.body).toContain('Uhr');
  });

  it('zeigt einen Fehler beim manuellen Prüfen, schweigt aber beim automatischen', async () => {
    const check = vi.fn(async () => {
      throw new UpdateError('network', 'x', ['fatal: Could not resolve host']);
    });
    const manual = setup({ check });
    const view = await manual.controller.check('manual');
    expect(view.stage).toBe('failed');
    expect(view.actions.map((a) => a.id)).toContain('retry-check');
    const auto = setup({ check });
    const quiet = await auto.controller.check('auto');
    expect(quiet.stage).toBe('idle');
    expect(quiet.message).toBeNull();
  });

  it('bereitet vor: Schritte und Zeilen laufen mit, am Ende ist die Fassung bereit', async () => {
    const gate = deferred<ReadyUpdate>();
    let hooks!: PrepareHooks;
    const prepare = vi.fn(async (h: PrepareHooks) => {
      hooks = h;
      return gate.promise;
    });
    const { controller } = setup({ prepare });
    await controller.check();
    const running = controller.start();
    expect(controller.stage).toBe('working');
    hooks.step('install');
    hooks.line('Packages: +1');
    const mid = controller.getView();
    expect(mid.stepNote).toBe('Schritt 2 von 4');
    expect(mid.log?.lines).toEqual(['Packages: +1']);
    gate.resolve(READY);
    const view = await running;
    expect(view.stage).toBe('ready');
    expect(view.actions.map((a) => a.id)).toContain('restart');
  });

  it('lässt „Jetzt aktualisieren“ nur aus „verfügbar“ zu und nie doppelt', async () => {
    const gate = deferred<ReadyUpdate>();
    const prepare = vi.fn(() => gate.promise);
    const { controller } = setup({ prepare });
    await controller.start(); // noch nichts geprüft
    expect(prepare).not.toHaveBeenCalled();
    await controller.check();
    void controller.start();
    await controller.start();
    expect(prepare).toHaveBeenCalledTimes(1);
    gate.resolve(READY);
  });

  it('bricht ab und geht zurück auf „verfügbar“', async () => {
    const prepare = vi.fn(
      (hooks: PrepareHooks) =>
        new Promise<ReadyUpdate>((_, reject) => {
          hooks.signal.addEventListener('abort', () => reject(new UpdateError('cancelled')));
        }),
    );
    const { controller } = setup({ prepare });
    await controller.check();
    const running = controller.start();
    controller.cancel();
    const view = await running;
    expect(view.stage).toBe('available');
    expect(view.message).toBe('Abgebrochen.');
  });

  it('merkt sich Fehler beim Vorbereiten und erlaubt einen neuen Versuch', async () => {
    let attempts = 0;
    const prepare = vi.fn(async (hooks: PrepareHooks) => {
      attempts += 1;
      hooks.line('ERR boom');
      if (attempts === 1) throw new UpdateError('build-failed', 'x');
      return READY;
    });
    const { controller } = setup({ prepare });
    await controller.check();
    const failed = await controller.start();
    expect(failed.stage).toBe('failed');
    expect(failed.actions.map((a) => a.id)).toEqual(['retry-start', 'show-log']);
    expect(failed.log?.lines).toEqual(['ERR boom']);
    const again = await controller.start();
    expect(again.stage).toBe('ready');
  });

  it('zeigt das Protokoll', () => {
    const { controller, deps } = setup();
    controller.showLog();
    expect(deps.revealLog).toHaveBeenCalledWith('/cache/update.log');
  });

  it('speichert den Schalter „Beim Start nach Updates suchen“', () => {
    const { controller } = setup();
    expect(controller.getView().autoCheck.checked).toBe(false);
    expect(controller.setAutoCheck(true).autoCheck.checked).toBe(true);
    expect(controller.setAutoCheck('ja' as unknown as boolean).autoCheck.checked).toBe(false);
  });
});

describe('Update: Neustart', () => {
  async function readyController(extra: Parameters<typeof setup>[0] = {}) {
    const ctx = setup({ loadReady: () => READY, ...extra });
    expect(ctx.controller.stage).toBe('ready');
    return ctx;
  }

  it('fragt nach, startet den Helfer losgelöst und beendet dann die App', async () => {
    const { controller, deps } = await readyController();
    const order: string[] = [];
    deps.confirmRestart.mockImplementation(async () => {
      order.push('frage');
      return true;
    });
    deps.spawnDetached.mockImplementation(async () => void order.push('helfer'));
    deps.quit.mockImplementation(() => void order.push('beenden'));
    await controller.restart();
    expect(order).toEqual(['frage', 'helfer', 'beenden']);
    expect(deps.confirmRestart).toHaveBeenCalledWith({ activeChats: 1, sessions: 2 });
    expect(deps.spawnDetached).toHaveBeenCalledWith({
      command: '/n/node',
      args: ['helfer.mjs'],
      env: { PATH: '/usr/bin' },
    });
    expect(controller.getView().message).toBe('Pagewise startet neu …');
  });

  it('beendet nichts, wenn die Person „Abbrechen“ wählt', async () => {
    const { controller, deps } = await readyController();
    deps.confirmRestart.mockResolvedValue(false);
    await controller.restart();
    expect(deps.spawnDetached).not.toHaveBeenCalled();
    expect(deps.quit).not.toHaveBeenCalled();
    expect(controller.stage).toBe('ready');
  });

  it('beendet nichts, wenn der Helfer sich nicht starten lässt', async () => {
    const { controller, deps } = await readyController();
    deps.spawnDetached.mockRejectedValue(new Error('ENOENT'));
    const view = await controller.restart();
    expect(deps.quit).not.toHaveBeenCalled();
    expect(view.stage).toBe('failed');
    expect(view.body).toContain('Austausch ließ sich nicht starten');
  });

  it('beendet nichts, wenn die vorbereitete Fassung inzwischen fehlt', async () => {
    let present = true;
    const { controller, deps } = await readyController({
      loadReady: () => (present ? READY : null),
    });
    present = false;
    const view = await controller.restart();
    expect(deps.confirmRestart).not.toHaveBeenCalled();
    expect(deps.quit).not.toHaveBeenCalled();
    expect(view.stage).toBe('failed');
    expect(view.body).toContain('gibt es nicht mehr');
  });

  it('startet nur aus dem Zustand „bereit“ und nur einmal', async () => {
    const idle = setup();
    await idle.controller.restart();
    expect(idle.deps.confirmRestart).not.toHaveBeenCalled();

    const gate = deferred<boolean>();
    const { controller, deps } = await readyController();
    deps.confirmRestart.mockReturnValue(gate.promise);
    const first = controller.restart();
    await controller.restart();
    expect(deps.confirmRestart).toHaveBeenCalledTimes(1);
    gate.resolve(false);
    await first;
  });
});
