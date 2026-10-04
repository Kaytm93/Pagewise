import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKOFF_MS,
  ConnectionMonitor,
  POLL_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  probeHealth,
} from './monitor';

const ok = () =>
  new Response(JSON.stringify({ status: 'ok', version: '1' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('probeHealth', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('meldet true nur für die Antwort des Servers', async () => {
    expect(await probeHealth(async () => ok())).toBe(true);
  });

  it('meldet false bei Fehlern des Servers, fremden Antworten und Netzfehlern', async () => {
    expect(await probeHealth(async () => new Response('Bad Gateway', { status: 502 }))).toBe(false);
    expect(await probeHealth(async () => new Response('Zu spät', { status: 504 }))).toBe(false);
    // Ein WLAN-Portal liefert 200 mit einer Seite.
    expect(await probeHealth(async () => new Response('<html>Anmelden</html>'))).toBe(false);
    expect(await probeHealth(async () => new Response(JSON.stringify({ status: 'kaputt' })))).toBe(
      false,
    );
    expect(await probeHealth(async () => new Response('null'))).toBe(false);
    expect(
      await probeHealth(async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).toBe(false);
  });

  it('bricht nach 4 Sekunden ab, wenn die Verbindung hängt', async () => {
    let aborted = false;
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('abgebrochen', 'AbortError'));
        });
      });
    const result = probeHealth(hanging);
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(false);
    expect(aborted).toBe(true);
  });

  it('fragt ohne Zwischenspeicher und nur /api/health', async () => {
    const fetchSpy = vi.fn(async () => ok());
    await probeHealth(fetchSpy as unknown as typeof fetch);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }),
    );
  });
});

/** Ein Ersatz für window und document, der Ereignisse auslösen kann. */
function targets() {
  const win = new EventTarget();
  const doc = new EventTarget();
  return { win, doc };
}

describe('ConnectionMonitor', () => {
  let reachable: boolean;
  let probes: number;
  let visible: boolean;
  let monitor: ConnectionMonitor;
  let t: ReturnType<typeof targets>;
  let recovered: ReturnType<typeof vi.fn<() => void>>;
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    reachable = true;
    probes = 0;
    visible = true;
    t = targets();
    monitor = new ConnectionMonitor({
      probe: async () => {
        probes += 1;
        return reachable;
      },
      isVisible: () => visible,
      windowTarget: t.win as unknown as Window,
      documentTarget: t.doc as unknown as Document,
    });
    recovered = vi.fn();
    monitor.onRecovered(recovered);
    stop = monitor.start();
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  const status = () => monitor.getSnapshot().status;

  it('beginnt online und prüft erst, wenn etwas den Anlass gibt', async () => {
    expect(status()).toBe('online');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    expect(probes).toBe(0);
  });

  it('prüft alle 30 Sekunden, solange die Seite sichtbar ist', async () => {
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(probes).toBe(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(probes).toBe(2);
    visible = false;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(probes).toBe(2);
  });

  it('prüft bei visibilitychange (nur sichtbar), pageshow, online und offline', async () => {
    visible = false;
    t.doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(probes).toBe(0);

    visible = true;
    t.doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(probes).toBe(1);
    for (const name of ['pageshow', 'online', 'offline']) {
      t.win.dispatchEvent(new Event(name));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(probes).toBe(4);
  });

  it('teilt sich eine laufende Probe', async () => {
    void monitor.check();
    void monitor.check();
    t.win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(probes).toBe(1);
  });

  it('geht bei einem Ausfall offline und wiederholt mit 2, 5, 10, 30, dann alle 30 Sekunden', async () => {
    reachable = false;
    await monitor.check();
    expect(status()).toBe('offline');
    expect(probes).toBe(1);

    const expected = [...BACKOFF_MS, 30_000, 30_000];
    let total = 1;
    for (const delay of expected) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(probes, `vor ${delay} ms`).toBe(total);
      await vi.advanceTimersByTimeAsync(1);
      total += 1;
      expect(probes, `nach ${delay} ms`).toBe(total);
      expect(status()).toBe('offline');
    }
    expect(recovered).not.toHaveBeenCalled();
  });

  it('meldet die Rückkehr genau einmal, geht online und hört mit den Wiederholungen auf', async () => {
    reachable = false;
    await monitor.check();
    reachable = true;
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
    expect(status()).toBe('online');
    expect(recovered).toHaveBeenCalledTimes(1);
    const before = probes;
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[1] + BACKOFF_MS[2]);
    expect(probes).toBe(before);
    // Wieder ausfallen: der Abstand beginnt von vorn bei 2 Sekunden.
    reachable = false;
    await monitor.check();
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
    expect(probes).toBe(before + 2);
  });

  it('meldet keine Rückkehr, wenn es nie einen Ausfall gab', async () => {
    await monitor.check();
    await monitor.check();
    expect(recovered).not.toHaveBeenCalled();
  });

  it('lässt „Erneut versuchen“ sofort prüfen und zeigt währenddessen „prüft“', async () => {
    reachable = false;
    await monitor.check();
    reachable = true;
    const pending = monitor.check();
    expect(monitor.getSnapshot().checking).toBe(true);
    await pending;
    expect(monitor.getSnapshot()).toEqual({ status: 'online', checking: false });
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it('wiederholt bei verborgener Seite nicht, prüft aber beim Zurückkehren', async () => {
    reachable = false;
    await monitor.check();
    visible = false;
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
    expect(probes).toBe(1);
    visible = true;
    reachable = true;
    t.doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(status()).toBe('online');
  });

  it('prüft nach einem Netzfehler der App sofort, aber nicht doppelt im Ausfall', async () => {
    reachable = false;
    monitor.noteNetworkError();
    await vi.advanceTimersByTimeAsync(0);
    expect(status()).toBe('offline');
    expect(probes).toBe(1);
    monitor.noteNetworkError();
    monitor.noteNetworkError();
    await vi.advanceTimersByTimeAsync(0);
    expect(probes).toBe(1);
  });

  it('wird mit stop() sauber abgehängt', async () => {
    stop();
    t.win.dispatchEvent(new Event('online'));
    t.doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(probes).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lässt einen fehlerhaften Zuhörer die anderen nicht aufhalten', async () => {
    const second = vi.fn();
    monitor.onRecovered(() => {
      throw new Error('kaputt');
    });
    monitor.onRecovered(second);
    reachable = false;
    await monitor.check();
    reachable = true;
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
