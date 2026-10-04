import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ChildHandle,
  DEFAULT_BACKOFF_MS,
  ServerSupervisor,
  type SupervisorOptions,
} from './supervisor';

/** Ersatz für den utilityProcess: sammelt Nachrichten und lässt den Test Meldungen und Austritt auslösen. */
class FakeChild implements ChildHandle {
  sent: Array<{ id: number; type: string }> = [];
  killed = 0;
  private messageHandler: (data: unknown) => void = () => {};
  private exitHandler: (code: number | null) => void = () => {};
  /** Antwortet auf `stop` mit Austritt (höflich beenden). */
  exitOnStop = true;
  exited = false;

  postMessage(message: unknown): void {
    const command = message as { id: number; type: string };
    this.sent.push(command);
    if (command.type === 'stop' && this.exitOnStop) {
      queueMicrotask(() => this.exit(0));
    }
  }
  kill(): boolean {
    this.killed += 1;
    queueMicrotask(() => this.exit(null));
    return true;
  }
  onMessage(handler: (data: unknown) => void): void {
    this.messageHandler = handler;
  }
  onExit(handler: (code: number | null) => void): void {
    this.exitHandler = handler;
  }
  emit(data: unknown): void {
    this.messageHandler(data);
  }
  ready(port = 3000): void {
    this.emit({ type: 'ready', host: '127.0.0.1', port, dataDir: '/tmp/beispiel' });
  }
  fail(kind: string, message = 'Meldung'): void {
    this.emit({ type: 'failed', kind, message });
  }
  exit(code: number | null): void {
    if (this.exited) return;
    this.exited = true;
    this.exitHandler(code);
  }
  reply(id: number, value: unknown): void {
    this.emit({ id, type: 'reply', ok: true, value });
  }
}

describe('ServerSupervisor', () => {
  let children: FakeChild[];
  let probeResult: boolean;
  let now: number;
  let supervisor: ServerSupervisor;

  function create(extra: Partial<SupervisorOptions> = {}): ServerSupervisor {
    return new ServerSupervisor({
      spawn: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      probe: async () => probeResult,
      now: () => now,
      ...extra,
    });
  }
  const last = () => children[children.length - 1] as FakeChild;
  const state = () => supervisor.getSnapshot().state;

  beforeEach(() => {
    vi.useFakeTimers();
    children = [];
    probeResult = true;
    now = 0;
    supervisor = create();
  });
  afterEach(() => vi.useRealTimers());

  it('startet, wartet auf ready und meldet den Port', () => {
    const changes: string[] = [];
    supervisor.onChange((s) => changes.push(`${s.state}:${s.port}`));
    expect(state()).toBe('stopped');
    supervisor.start();
    expect(state()).toBe('starting');
    last().ready(3000);
    expect(supervisor.getSnapshot()).toMatchObject({ state: 'running', port: 3000, failure: null });
    expect(changes).toEqual(['starting:null', 'running:3000']);
  });

  it('startet nicht doppelt', () => {
    supervisor.start();
    supervisor.start();
    expect(children).toHaveLength(1);
  });

  it('gibt bei einem belegten Port auf, ohne es in Dauerschleife zu versuchen', async () => {
    supervisor.start();
    last().fail('port_in_use', 'Der Port 3000 ist belegt.');
    last().exit(0);
    expect(supervisor.getSnapshot()).toMatchObject({
      state: 'failed',
      failure: { kind: 'port_in_use', message: 'Der Port 3000 ist belegt.' },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(1);
    // Ein erneuter Versuch auf Wunsch ist möglich.
    supervisor.start();
    expect(children).toHaveLength(2);
    expect(state()).toBe('starting');
  });

  it.each(['instance_running', 'config', 'data_dir', 'database'])(
    'wiederholt auch bei %s nicht',
    async (kind) => {
      supervisor.start();
      last().fail(kind);
      last().exit(0);
      expect(supervisor.getSnapshot().failure?.kind).toBe(kind);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(children).toHaveLength(1);
    },
  );

  it('startet nach einem Absturz mit wachsender Pause neu', async () => {
    supervisor.start();
    last().ready();
    expect(DEFAULT_BACKOFF_MS).toEqual([500, 1_000, 2_000, 4_000, 8_000]);

    last().exit(1);
    expect(supervisor.getSnapshot()).toMatchObject({ state: 'restarting', restarts: 1 });
    await vi.advanceTimersByTimeAsync(499);
    expect(children).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(children).toHaveLength(2);
    last().ready();
    expect(state()).toBe('running');

    now += 1_000;
    last().exit(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(children).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(children).toHaveLength(3);
  });

  it('gibt nach fünf Abstürzen innerhalb einer Minute mit Fehlermeldung auf', async () => {
    supervisor.start();
    for (let i = 0; i < 4; i += 1) {
      last().exit(1);
      expect(state()).toBe('restarting');
      now += 1_000;
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(children).toHaveLength(5);
    last().exit(1);
    expect(supervisor.getSnapshot()).toMatchObject({
      state: 'failed',
      failure: { kind: 'crash_loop' },
    });
    expect(supervisor.getSnapshot().failure?.message).toContain('abgestürzt');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(children).toHaveLength(5);
  });

  it('zählt Abstürze, die länger als eine Minute zurückliegen, nicht mit', async () => {
    supervisor.start();
    for (let i = 0; i < 8; i += 1) {
      last().exit(1);
      expect(state()).toBe('restarting');
      now += 70_000;
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(children).toHaveLength(9);
    expect(state()).not.toBe('failed');
  });

  it('beendet einen Server, der sich nicht meldet, und startet neu', async () => {
    supervisor.start();
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(children[0]?.killed).toBe(1);
    expect(supervisor.getSnapshot().state).toBe('restarting');
    expect(supervisor.getSnapshot().failure?.kind).toBe('start_timeout');
  });

  it('startet neu, wenn der Prozess lebt, aber dreimal hintereinander nicht auf /api/health antwortet', async () => {
    supervisor.start();
    last().ready();
    probeResult = false;
    await vi.advanceTimersByTimeAsync(15_000 * 2);
    expect(children[0]?.killed).toBe(0);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(children[0]?.killed).toBe(1);
    expect(state()).toBe('restarting');
  });

  it('setzt die Zählung der Fehlproben bei einer guten Probe zurück', async () => {
    supervisor.start();
    last().ready();
    probeResult = false;
    await vi.advanceTimersByTimeAsync(15_000 * 2);
    probeResult = true;
    await vi.advanceTimersByTimeAsync(15_000);
    probeResult = false;
    await vi.advanceTimersByTimeAsync(15_000 * 2);
    expect(children[0]?.killed).toBe(0);
  });

  it('beantwortet Befehle über den Kanal und wertet Status und Einrichtungscode aus', async () => {
    supervisor.start();
    last().ready();
    const status = supervisor.serverStatus();
    expect(last().sent.at(-1)).toMatchObject({ type: 'status' });
    last().reply(last().sent.at(-1)?.id ?? -1, {
      port: 3000,
      activeChats: 2,
      sessions: 3,
      setupPending: false,
    });
    expect(await status).toEqual({ port: 3000, activeChats: 2, sessions: 3, setupPending: false });

    const code = supervisor.setupCode();
    last().reply(last().sent.at(-1)?.id ?? -1, { code: 'ABCDE-FGHJK' });
    expect(await code).toBe('ABCDE-FGHJK');
  });

  it('antwortet auf Befehle ohne laufenden Server und bei Zeitüberschreitung mit „nicht möglich“', async () => {
    expect(await supervisor.serverStatus()).toBeNull();
    expect(await supervisor.setupCode()).toBeNull();
    supervisor.start();
    last().ready();
    const status = supervisor.serverStatus();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await status).toBeNull();
  });

  it('verwirft ungültige Nachrichten des Kindes', () => {
    supervisor.start();
    last().emit({ type: 'ready', port: 'x' });
    last().emit('ready');
    last().emit(null);
    expect(state()).toBe('starting');
  });

  it('beendet höflich über den Kanal und meldet gestoppt', async () => {
    supervisor.start();
    last().ready();
    await supervisor.stop();
    expect(last().sent.at(-1)).toMatchObject({ type: 'stop' });
    expect(last().killed).toBe(0);
    expect(supervisor.getSnapshot()).toMatchObject({ state: 'stopped', port: null });
    // Danach startet nichts mehr von selbst.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(1);
  });

  it('beendet mit kill, wenn der Server nicht rechtzeitig aufhört (kein verwaister Kindprozess)', async () => {
    supervisor.start();
    last().ready();
    last().exitOnStop = false;
    const stopped = supervisor.stop(8_000);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(last().killed).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await stopped;
    expect(last().killed).toBe(1);
    expect(state()).toBe('stopped');
  });

  it('startet nach dem Beenden nicht neu, auch nicht aus einer laufenden Pause', async () => {
    supervisor.start();
    last().ready();
    last().exit(1);
    expect(state()).toBe('restarting');
    await supervisor.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(1);
  });

  it('startet auf Wunsch neu und beginnt mit leerer Absturzliste', async () => {
    supervisor.start();
    last().ready();
    await supervisor.restart();
    expect(children).toHaveLength(2);
    expect(state()).toBe('starting');
    last().ready();
    expect(supervisor.getSnapshot().restarts).toBe(0);
  });

  it('meldet einen Fehler beim Starten des Prozesses als Fehler statt abzustürzen', () => {
    const broken = create({
      spawn: () => {
        throw new Error('kein Prozess');
      },
    });
    broken.start();
    expect(broken.getSnapshot()).toMatchObject({ state: 'failed', failure: { kind: 'other' } });
  });

  it('ignoriert späte Meldungen eines alten Kindes', async () => {
    supervisor.start();
    const old = last();
    old.ready();
    old.exit(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(children).toHaveLength(2);
    old.ready(4000);
    expect(supervisor.getSnapshot().port).toBeNull();
    last().ready(3000);
    expect(supervisor.getSnapshot().port).toBe(3000);
  });
});
