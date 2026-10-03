import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { z } from 'zod';

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * Liest den JSON-Körper und prüft ihn gegen ein Schema. Bei Fehlern kommt eine fertige 400er-Antwort
 * mit Fehlercode und Feldname zurück, nie die Eingabe selbst.
 */
export async function readJson<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<ParsedBody<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: 'invalid_json' }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      ok: false,
      response: c.json(
        { error: 'invalid_input', field: typeof field === 'string' ? field : null },
        400,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Begrenzt die Größe des Anfragekörpers. Zu große Körper werden mit 413 abgelehnt. */
export function limitBody(maxSize: number): MiddlewareHandler {
  return bodyLimit({ maxSize, onError: (c) => c.json({ error: 'payload_too_large' }, 413) });
}
