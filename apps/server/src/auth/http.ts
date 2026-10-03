import { timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../http/types';
import type { SessionService } from './sessions';

export const SESSION_COOKIE = 'pagewise_session';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Der Cookie bekommt `Secure`, wenn die Anfrage per HTTPS kam. Hinter Tailscale Serve endet HTTPS
 * am Proxy, dann entscheidet `X-Forwarded-Proto`. Beim direkten Zugriff über http://localhost
 * bleibt `Secure` aus, weil Browser solche Cookies dort teils nicht annehmen.
 */
function isSecureRequest(c: Context): boolean {
  const forwarded = c.req.header('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0]?.trim().toLowerCase() === 'https';
  return new URL(c.req.url).protocol === 'https:';
}

export function setSessionCookie(c: Context, token: string, maxAgeSeconds: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: maxAgeSeconds,
    secure: isSecureRequest(c),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isSecureRequest(c) });
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Liest den Sitzungs-Cookie, prüft ihn und verlängert die Laufzeit gelegentlich. */
export function loadSession(sessions: SessionService): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE) ?? null;
    const active = sessions.validate(token ?? undefined);
    c.set('session', active);
    c.set('sessionToken', active ? token : null);
    if (active?.renewed && token) setSessionCookie(c, token, active.maxAgeSeconds);
    await next();
  };
}

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('session')) return c.json({ error: 'unauthorized' }, 401);
  await next();
};

/**
 * Schutz gegen Cross-Site-Anfragen bei ändernden Methoden:
 * 1. Das Cookie ist SameSite=Strict.
 * 2. Der Browser meldet mit `Sec-Fetch-Site`, woher eine Anfrage kommt. Alles außer der eigenen
 *    Herkunft (oder einer direkten Eingabe) wird abgelehnt.
 * 3. Mit Sitzung muss das CSRF-Token der Sitzung im Header mitkommen. Eine fremde Seite kennt es
 *    nicht und darf es wegen der Same-Origin-Regeln nicht auslesen.
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const site = c.req.header('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return c.json({ error: 'csrf' }, 403);
  }
  const session = c.get('session');
  if (session) {
    const sent = c.req.header(CSRF_HEADER);
    if (!sent || !safeEqual(sent, session.csrfToken)) return c.json({ error: 'csrf' }, 403);
  }
  await next();
};
