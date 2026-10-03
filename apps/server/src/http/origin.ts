import type { MiddlewareHandler } from 'hono';

/** Der Rechnername einer Anfrage: hinter einem Proxy der weitergegebene, sonst der eigene. */
function requestHost(headers: (name: string) => string | undefined): string | null {
  const forwarded = headers('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwarded || headers('host');
  return host ? host.toLowerCase() : null;
}

/**
 * Strenge CORS-Regel: Pagewise erlaubt nur Anfragen von der eigenen Adresse. Es gibt keine
 * `Access-Control-*`-Antwortheader, also keine Ausnahme für andere Herkunft, und eine Anfrage mit
 * fremdem `Origin` (auch `null`) wird abgelehnt, bevor sie etwas auslösen kann. Anfragen ohne `Origin`
 * (gleiche Herkunft per GET, Befehlszeile) laufen weiter, die ändernden Methoden prüft zusätzlich
 * der CSRF-Schutz (`csrfGuard`).
 */
export const originGuard: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('origin');
  if (origin === undefined) return next();

  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    // Unlesbarer Wert (z. B. „null“): wie eine fremde Herkunft behandeln.
  }
  if (!originHost || originHost !== requestHost((name) => c.req.header(name))) {
    return c.json({ error: 'cross_origin' }, 403);
  }
  return next();
};
