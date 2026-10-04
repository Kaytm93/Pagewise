import { z } from 'zod';
import { fail, hasControlChars, LIMITS, ok, type Result } from '../errors';

const range = z
  .tuple([z.number().finite(), z.number().finite()])
  .refine(([min, max]) => min < max && max - min <= 1_000_000);

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !hasControlChars(value));

const fn = z.union([
  text(200).transform((expr) => ({ expr, label: undefined as string | undefined })),
  z.strictObject({ expr: text(200), label: text(40).optional() }),
]);

const point = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  label: text(40).optional(),
});

/**
 * Aufbau eines ` ```graph `-Blocks (JSON): `functions` (ein bis sechs Ausdrücke, als Text oder mit Beschriftung),
 * `x` und `y` als Bereiche (`y` entfällt: wird aus den Werten bestimmt), `points` für markierte Punkte
 * (zum Beispiel Nullstellen), `grid` für das Gitter. Unbekannte Felder werden abgelehnt.
 */
export const graphSpecSchema = z.strictObject({
  functions: z.array(fn).min(1).max(6),
  x: range.optional(),
  y: range.optional(),
  points: z.array(point).max(20).optional(),
  grid: z.boolean().optional(),
});

export interface GraphSpec {
  functions: { expr: string; label: string | undefined }[];
  x: [number, number];
  y: [number, number] | null;
  points: { x: number; y: number; label: string | undefined }[];
  grid: boolean;
}

export function parseGraphSpec(source: string): Result<GraphSpec> {
  if (source.trim() === '') return fail('empty');
  if (source.length > LIMITS.graph) return fail('too_large');
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return fail('invalid_json');
  }
  const parsed = graphSpecSchema.safeParse(json);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.filter((part) => typeof part === 'string')[0];
    return fail('invalid_spec', typeof path === 'string' ? path : undefined);
  }
  const value = parsed.data;
  return ok({
    functions: value.functions.map((entry) => ({ expr: entry.expr, label: entry.label })),
    x: value.x ?? [-10, 10],
    y: value.y ?? null,
    points: (value.points ?? []).map((p) => ({ x: p.x, y: p.y, label: p.label })),
    grid: value.grid ?? true,
  });
}
