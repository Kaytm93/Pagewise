import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { createApp } from './app';
import { AttemptLimiter } from './auth/attempt-limiter';
import type { AppEnv } from './http/types';
import { createServices, type Services } from './services';

export const TEST_PASSCODE = 'ein erfundener Beispiel-Passcode';

export interface Reply {
  status: number;
  body: Record<string, unknown>;
  text: string;
  headers: Headers;
  cookie: string | null;
}

export interface CallOptions {
  body?: unknown;
  rawBody?: string;
  cookie?: string | null;
  csrf?: string;
  headers?: Record<string, string>;
}

export interface Session {
  cookie: string;
  csrf: string;
  /** Anfrage mit Cookie und CSRF-Token dieser Sitzung. */
  call(method: string, path: string, body?: unknown): Promise<Reply>;
}

/** Ein echter App-Aufbau (Datenbank im Temp-Ordner, schnelles Hashing) für HTTP-Tests ohne Netzwerk. */
export interface Harness {
  services: Services;
  app: Hono<AppEnv>;
  call(method: string, path: string, options?: CallOptions): Promise<Reply>;
  /** „pagewise_session=abc; Path=/“ wird zu „pagewise_session=abc“. */
  pair(setCookie: string | null): string;
  /** Richtet Pagewise ein und gibt die angemeldete Sitzung zurück. */
  signIn(): Promise<Session>;
  close(): void;
}

export function createHarness(options: { maxFailures?: number } = {}): Harness {
  const base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
  const services = createServices(join(base, 'daten'), {
    scryptParams: { N: 16, r: 8, p: 1 },
    limiter: new AttemptLimiter({ maxFailures: options.maxFailures ?? 3 }),
  });
  const app = createApp({ version: '1.2.3', services });

  async function call(method: string, path: string, opts: CallOptions = {}): Promise<Reply> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.csrf) headers['x-csrf-token'] = opts.csrf;
    let body: string | undefined = opts.rawBody;
    if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['content-type'] = 'application/json';
    }
    // GET und HEAD dürfen laut Fetch-Standard keinen Körper haben.
    if (method === 'GET' || method === 'HEAD') body = undefined;
    const response = await app.request(path, { method, headers, body });
    const text = await response.text();
    const setCookie = response.headers
      .getSetCookie()
      .find((c) => c.startsWith('pagewise_session='));
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      // Antworten ohne JSON (z. B. 204) haben keinen Körper.
    }
    return {
      status: response.status,
      body: parsed,
      text,
      headers: response.headers,
      cookie: setCookie ?? null,
    };
  }

  const pair = (setCookie: string | null): string => setCookie?.split(';')[0] ?? '';

  async function signIn(): Promise<Session> {
    const reply = await call('POST', '/api/auth/setup', {
      body: { setupCode: services.auth.pendingSetupCode(), passcode: TEST_PASSCODE },
    });
    if (reply.status !== 201)
      throw new Error(`Testaufbau: Einrichtung scheiterte (${reply.status})`);
    const cookie = pair(reply.cookie);
    const csrf = String(reply.body.csrfToken);
    return {
      cookie,
      csrf,
      call: (method, path, body) => call(method, path, { cookie, csrf, body }),
    };
  }

  return {
    services,
    app,
    call,
    pair,
    signIn,
    close: () => {
      services.close();
      rmSync(base, { recursive: true, force: true });
    },
  };
}
