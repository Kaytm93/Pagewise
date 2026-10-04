import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(__dirname, '..', '..', 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://pagewise.example.test';

type Listener = (event: never) => void;

/** Kleiner Ersatz für den Cache-Speicher des Browsers. */
class FakeCache {
  entries = new Map<string, Response>();
  private key = (request: Request | string) =>
    new URL(typeof request === 'string' ? request : request.url, ORIGIN).pathname;
  async match(request: Request | string) {
    return this.entries.get(this.key(request))?.clone();
  }
  async put(request: Request | string, response: Response) {
    this.entries.set(this.key(request), response);
  }
  async keys() {
    return [...this.entries.keys()].map((path) => new Request(`${ORIGIN}${path}`));
  }
  async delete(request: Request | string) {
    return this.entries.delete(this.key(request));
  }
}

function load(network: (request: Request) => Promise<Response>) {
  const stores = new Map<string, FakeCache>();
  const listeners = new Map<string, Listener>();
  const skipWaiting = vi.fn();
  const claim = vi.fn(async () => {});
  // Im Browser sind Antworten derselben Herkunft vom Typ „basic“, in Node nicht.
  const fetchSpy = vi.fn(async (input: Request | string) => {
    // Im Service Worker nimmt fetch auch eine Adresse als Text.
    const request = typeof input === 'string' ? new Request(new URL(input, ORIGIN)) : input;
    const response = await network(request);
    Object.defineProperty(response, 'type', { value: 'basic' });
    return response;
  });
  const sandbox = {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
      skipWaiting,
      clients: { claim },
    },
    caches: {
      open: async (name: string) => {
        if (!stores.has(name)) stores.set(name, new FakeCache());
        return stores.get(name) as FakeCache;
      },
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    },
    fetch: fetchSpy,
    // Lazy, damit die Zeit der Tests (vi.useFakeTimers) greift.
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    URL,
    Request,
    Response,
    Error,
    Promise,
    Symbol,
    Math,
  };
  vm.runInNewContext(source, sandbox);
  /** Arbeiten im Hintergrund (`waitUntil`), z. B. das Merken einer späten Netzantwort. */
  const background: Promise<unknown>[] = [];
  return {
    stores,
    listeners,
    skipWaiting,
    claim,
    fetchSpy,
    background,
    settle: () => Promise.all(background.splice(0)),
  };
}

/** Löst ein fetch-Ereignis aus und gibt zurück, ob der Service Worker geantwortet hat (und was). */
async function dispatch(
  worker: ReturnType<typeof load>,
  path: string,
  init: { method?: string; mode?: RequestMode; origin?: string } = {},
): Promise<Response | 'ignored'> {
  const request = new Request(`${init.origin ?? ORIGIN}${path}`, { method: init.method ?? 'GET' });
  Object.defineProperty(request, 'mode', { value: init.mode ?? 'no-cors' });
  let answer: Promise<Response> | undefined;
  const listener = worker.listeners.get('fetch') as Listener;
  listener({
    request,
    respondWith: (promise: Promise<Response>) => (answer = promise),
    waitUntil: (promise: Promise<unknown>) => worker.background.push(promise),
  } as never);
  return answer ? await answer : 'ignored';
}

const page = (body = '<!doctype html>') =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Service Worker', () => {
  it('holt das Startskript zuerst aus dem Netz und zeigt ohne Netz die gemerkte Fassung', async () => {
    let online = true;
    const worker = load(async () => {
      if (!online) throw new TypeError('offline');
      return new Response('boot();', { headers: { 'content-type': 'text/javascript' } });
    });
    const first = (await dispatch(worker, '/boot.js')) as Response;
    expect(await first.text()).toBe('boot();');
    online = false;
    const offline = (await dispatch(worker, '/boot.js')) as Response;
    expect(await offline.text()).toBe('boot();');
  });

  it('merkt Startseite und Startskript schon bei der Installation (Rückfall für den zweiten Start)', async () => {
    const worker = load(async (request) =>
      request.url.endsWith('/boot.js')
        ? new Response('boot();', { headers: { 'content-type': 'text/javascript' } })
        : page('<p>Start</p>'),
    );
    (worker.listeners.get('install') as Listener)({
      waitUntil: (promise: Promise<unknown>) => worker.background.push(promise),
    } as never);
    await worker.settle();
    const shell = worker.stores.get('pagewise-shell-v2');
    expect(await (await shell?.match('/'))?.text()).toBe('<p>Start</p>');
    expect(await (await shell?.match('/boot.js'))?.text()).toBe('boot();');
  });

  it('übersteht ein fehlendes Netz bei der Installation', async () => {
    const worker = load(async () => {
      throw new TypeError('offline');
    });
    (worker.listeners.get('install') as Listener)({
      waitUntil: (promise: Promise<unknown>) => worker.background.push(promise),
    } as never);
    await expect(worker.settle()).resolves.toBeDefined();
    expect(worker.skipWaiting).toHaveBeenCalled();
    expect(await worker.stores.get('pagewise-shell-v2')?.match('/')).toBeUndefined();
  });

  it('merkt bei der Installation keine Fehlerseiten', async () => {
    const worker = load(
      async () =>
        new Response('Bad Gateway', { status: 502, headers: { 'content-type': 'text/html' } }),
    );
    (worker.listeners.get('install') as Listener)({
      waitUntil: (promise: Promise<unknown>) => worker.background.push(promise),
    } as never);
    await worker.settle();
    expect(await worker.stores.get('pagewise-shell-v2')?.match('/')).toBeUndefined();
  });

  describe('Zeitlimit bei hängendem Netz (der Mac schläft, Tailscale ist verbunden)', () => {
    afterEach(() => vi.useRealTimers());

    /** Antwortet erst, wenn der Test es erlaubt. */
    function hanging() {
      let release: (response: Response) => void = () => {};
      const reply = new Promise<Response>((resolve) => {
        release = resolve;
      });
      return { reply, release: (response: Response) => release(response) };
    }

    it('liefert die gemerkte Seite nach 3 Sekunden und merkt sich die späte Netzantwort', async () => {
      vi.useFakeTimers();
      let hang: ReturnType<typeof hanging> | null = null;
      const worker = load(async () => (hang ? hang.reply : page('<p>alt</p>')));
      await dispatch(worker, '/', { mode: 'navigate' });

      hang = hanging();
      let answered: Response | 'ignored' | null = null;
      const pending = dispatch(worker, '/subjects/1', { mode: 'navigate' }).then((r) => {
        answered = r;
      });
      await vi.advanceTimersByTimeAsync(2_999);
      expect(answered).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(await (answered as unknown as Response).text()).toBe('<p>alt</p>');

      // Später kommt die Netzantwort: Sie landet im Speicher, die nächste Anfrage bekommt sie.
      hang.release(page('<p>neu</p>'));
      await worker.settle();
      const stored = await worker.stores.get('pagewise-shell-v2')?.match('/');
      expect(await stored?.text()).toBe('<p>neu</p>');
    });

    it('wartet nicht, wenn das Netz rechtzeitig antwortet', async () => {
      vi.useFakeTimers();
      const worker = load(async () => page('<p>frisch</p>'));
      await dispatch(worker, '/', { mode: 'navigate' });
      const response = (await dispatch(worker, '/', { mode: 'navigate' })) as Response;
      expect(await response.text()).toBe('<p>frisch</p>');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('lässt das Startskript nach 1,5 Sekunden fallen und nimmt die gemerkte Fassung', async () => {
      vi.useFakeTimers();
      let hang: ReturnType<typeof hanging> | null = null;
      const worker = load(async () =>
        hang
          ? hang.reply
          : new Response('boot(1);', { headers: { 'content-type': 'text/javascript' } }),
      );
      await dispatch(worker, '/boot.js');

      hang = hanging();
      let answered: Response | 'ignored' | null = null;
      const pending = dispatch(worker, '/boot.js').then((r) => {
        answered = r;
      });
      await vi.advanceTimersByTimeAsync(1_499);
      expect(answered).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(await (answered as unknown as Response).text()).toBe('boot(1);');

      hang.release(new Response('boot(2);', { headers: { 'content-type': 'text/javascript' } }));
      await worker.settle();
      const stored = await worker.stores.get('pagewise-shell-v2')?.match('/boot.js');
      expect(await stored?.text()).toBe('boot(2);');
    });

    it('wartet ohne gemerkte Seite auf das Netz (es gibt nichts anderes zu zeigen)', async () => {
      vi.useFakeTimers();
      const hang = hanging();
      const worker = load(async () => hang.reply);
      let answered: Response | 'ignored' | null = null;
      const pending = dispatch(worker, '/', { mode: 'navigate' }).then((r) => {
        answered = r;
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(answered).toBeNull();
      hang.release(page('<p>endlich</p>'));
      await pending;
      expect(await (answered as unknown as Response).text()).toBe('<p>endlich</p>');
      const stored = await worker.stores.get('pagewise-shell-v2')?.match('/');
      expect(await stored?.text()).toBe('<p>endlich</p>');
    });

    it('zeigt die gemerkte Seite, wenn Tailscale Serve mit 502 bis 504 antwortet (Server dahinter fehlt)', async () => {
      let status = 200;
      const worker = load(async () =>
        status === 200
          ? page('<p>Oberfläche</p>')
          : new Response('Bad Gateway', { status, headers: { 'content-type': 'text/html' } }),
      );
      await dispatch(worker, '/', { mode: 'navigate' });
      for (const code of [502, 503, 504]) {
        status = code;
        const response = (await dispatch(worker, '/', { mode: 'navigate' })) as Response;
        expect(await response.text(), String(code)).toBe('<p>Oberfläche</p>');
      }
      // Ein echter Fehler der App (500) wird nicht überdeckt, und die Fehlerseite wird nie gemerkt.
      status = 500;
      const failure = (await dispatch(worker, '/', { mode: 'navigate' })) as Response;
      expect(failure.status).toBe(500);
      const stored = await worker.stores.get('pagewise-shell-v2')?.match('/');
      expect(await stored?.text()).toBe('<p>Oberfläche</p>');
    });
  });

  it('fasst die API nie an, auch nicht den Antwort-Strom', async () => {
    const worker = load(async () => new Response('geheim'));
    for (const path of [
      '/api/chats',
      '/api/chats/1/messages',
      '/api/session',
      '/api/chats/1/generation',
    ]) {
      expect(await dispatch(worker, path), path).toBe('ignored');
    }
    expect(await dispatch(worker, '/api/chats/1/messages', { method: 'POST' })).toBe('ignored');
    expect(worker.fetchSpy).not.toHaveBeenCalled();
    expect(worker.stores.size).toBe(0);
  });

  it('ignoriert alles außer GET und fremde Herkunft', async () => {
    const worker = load(async () => page());
    expect(await dispatch(worker, '/assets/a.js', { method: 'POST' })).toBe('ignored');
    expect(await dispatch(worker, '/assets/a.js', { origin: 'https://fremd.example.test' })).toBe(
      'ignored',
    );
    // Andere Dateien (z. B. das Manifest) gehen unverändert ans Netz.
    expect(await dispatch(worker, '/manifest.webmanifest')).toBe('ignored');
  });

  it('holt Seiten zuerst aus dem Netz und merkt sich die Startseite', async () => {
    const worker = load(async () => page('<p>neu</p>'));
    const response = await dispatch(worker, '/subjects/1', { mode: 'navigate' });
    expect(response).not.toBe('ignored');
    expect(await (response as Response).text()).toBe('<p>neu</p>');
    const stored = await worker.stores.get('pagewise-shell-v2')?.match('/');
    expect(await stored?.text()).toBe('<p>neu</p>');
  });

  it('zeigt ohne Netz die gemerkte Startseite für jede Adresse der App', async () => {
    let online = true;
    const worker = load(async () => {
      if (!online) throw new TypeError('offline');
      return page('<p>Startseite</p>');
    });
    await dispatch(worker, '/', { mode: 'navigate' });
    online = false;
    const response = await dispatch(worker, '/subjects/1/chats/2', { mode: 'navigate' });
    expect(await (response as Response).text()).toBe('<p>Startseite</p>');
  });

  it('merkt sich nur HTML-Seiten, keine Fehler und keine anderen Dateien', async () => {
    const worker = load(async (request) =>
      request.url.endsWith('/kaputt')
        ? new Response('Fehler', { status: 500, headers: { 'content-type': 'text/html' } })
        : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await dispatch(worker, '/kaputt', { mode: 'navigate' });
    await dispatch(worker, '/daten.json', { mode: 'navigate' });
    expect(await worker.stores.get('pagewise-shell-v2')?.match('/')).toBeUndefined();
  });

  it('meldet den Fehler, wenn weder Netz noch gemerkte Seite da sind', async () => {
    const worker = load(async () => {
      throw new TypeError('offline');
    });
    await expect(dispatch(worker, '/', { mode: 'navigate' })).rejects.toThrow('offline');
  });

  it('holt Dateien mit Hash aus dem Speicher und fragt das Netz nur einmal', async () => {
    const worker = load(async () => new Response('console.log(1)', { status: 200 }));
    const first = await dispatch(worker, '/assets/app-abc123.js');
    const second = await dispatch(worker, '/assets/app-abc123.js');
    expect(await (first as Response).text()).toBe('console.log(1)');
    expect(await (second as Response).text()).toBe('console.log(1)');
    expect(worker.fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('speichert fehlgeschlagene Anfragen nicht', async () => {
    const worker = load(async () => new Response('weg', { status: 404 }));
    await dispatch(worker, '/assets/alt-1.js');
    await dispatch(worker, '/assets/alt-1.js');
    expect(worker.fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('hält den Speicher für Dateien klein', async () => {
    const worker = load(async (request) => new Response(request.url, { status: 200 }));
    for (let i = 0; i < 100; i += 1) await dispatch(worker, `/assets/datei-${i}.js`);
    const cache = worker.stores.get('pagewise-assets-v2') as FakeCache;
    expect(cache.entries.size).toBe(80);
    // Die ältesten sind weg, die neuesten da.
    expect(cache.entries.has('/assets/datei-0.js')).toBe(false);
    expect(cache.entries.has('/assets/datei-99.js')).toBe(true);
  });

  it('übernimmt eine neue Version sofort und räumt alte Speicher auf', async () => {
    const worker = load(async () => page());
    worker.stores.set('pagewise-shell-v0', new FakeCache());
    worker.stores.set('etwas-anderes', new FakeCache());
    await dispatch(worker, '/', { mode: 'navigate' });

    (worker.listeners.get('install') as Listener)({
      waitUntil: (promise: Promise<unknown>) => worker.background.push(promise),
    } as never);
    expect(worker.skipWaiting).toHaveBeenCalled();
    await worker.settle();

    let waiting: Promise<unknown> | undefined;
    (worker.listeners.get('activate') as Listener)({
      waitUntil: (promise: Promise<unknown>) => (waiting = promise),
    } as never);
    await waiting;
    expect(worker.claim).toHaveBeenCalled();
    expect([...worker.stores.keys()].sort()).toEqual(['pagewise-shell-v2']);
  });

  it('legt keine Antworten der API in den Speicher, auch nicht über die Startseite', () => {
    // Zusicherung am Quelltext: kein Pfad außer / und /assets, /icons wird gespeichert.
    expect(source).not.toMatch(/\/api\/[^'"]*cache\.put/);
    expect(source).toContain("url.pathname.startsWith('/api/')");
  });
});
