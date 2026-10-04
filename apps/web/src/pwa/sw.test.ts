import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  const fetchSpy = vi.fn(async (request: Request) => {
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
    URL,
    Request,
    Response,
    Error,
    Promise,
    Math,
  };
  vm.runInNewContext(source, sandbox);
  return { stores, listeners, skipWaiting, claim, fetchSpy };
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
  listener({ request, respondWith: (promise: Promise<Response>) => (answer = promise) } as never);
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
    const stored = await worker.stores.get('pagewise-shell-v1')?.match('/');
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
    expect(await worker.stores.get('pagewise-shell-v1')?.match('/')).toBeUndefined();
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
    const cache = worker.stores.get('pagewise-assets-v1') as FakeCache;
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

    (worker.listeners.get('install') as Listener)({} as never);
    expect(worker.skipWaiting).toHaveBeenCalled();

    let waiting: Promise<unknown> | undefined;
    (worker.listeners.get('activate') as Listener)({
      waitUntil: (promise: Promise<unknown>) => (waiting = promise),
    } as never);
    await waiting;
    expect(worker.claim).toHaveBeenCalled();
    expect([...worker.stores.keys()].sort()).toEqual(['pagewise-shell-v1']);
  });

  it('legt keine Antworten der API in den Speicher, auch nicht über die Startseite', () => {
    // Zusicherung am Quelltext: kein Pfad außer / und /assets, /icons wird gespeichert.
    expect(source).not.toMatch(/\/api\/[^'"]*cache\.put/);
    expect(source).toContain("url.pathname.startsWith('/api/')");
  });
});
