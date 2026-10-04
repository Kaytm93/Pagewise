import { fail, hasControlChars, LIMITS, ok, type Result } from '../errors';

export interface GraphSpec {
  functions: { expr: string; label: string | undefined }[];
  x: [number, number];
  y: [number, number] | null;
  points: { x: number; y: number; label: string | undefined }[];
  grid: boolean;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && !hasControlChars(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Nur diese Schlüssel sind erlaubt, alles andere lehnt die Prüfung ab (wie bei einem strikten Schema). */
const hasOnly = (value: Json, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

function range(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [min, max] = value;
  if (!isFiniteNumber(min) || !isFiniteNumber(max) || min >= max || max - min > 1_000_000)
    return null;
  return [min, max];
}

/**
 * Liest den Inhalt eines ` ```graph `-Blocks (JSON): `functions` (ein bis sechs Ausdrücke, als Text oder mit
 * Beschriftung), `x` und `y` als Bereiche (`y` entfällt: wird aus den Werten bestimmt), `points` für markierte
 * Punkte (zum Beispiel Nullstellen), `grid` für das Gitter. Unbekannte Felder werden abgelehnt. Von Hand
 * geprüft statt mit einer Schema-Bibliothek: Die Bibliothek prüft beim Start, ob `new Function` erlaubt ist, und
 * würde damit in der Konsole einen Verstoß gegen die CSP melden.
 *
 * Fehler tragen als Hinweis nur den Namen des Feldes, nie Text aus der Eingabe.
 */
export function parseGraphSpec(source: string): Result<GraphSpec> {
  if (source.trim() === '') return fail('empty');
  if (source.length > LIMITS.graph) return fail('too_large');
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return fail('invalid_json');
  }
  if (!isObject(json)) return fail('invalid_spec');
  if (!hasOnly(json, ['functions', 'x', 'y', 'points', 'grid'])) return fail('invalid_spec');

  const rawFunctions = json.functions;
  if (!Array.isArray(rawFunctions) || rawFunctions.length < 1 || rawFunctions.length > 6) {
    return fail('invalid_spec', 'functions');
  }
  const functions: GraphSpec['functions'] = [];
  for (const entry of rawFunctions) {
    if (isText(entry, LIMITS.expression)) {
      functions.push({ expr: entry, label: undefined });
    } else if (
      isObject(entry) &&
      hasOnly(entry, ['expr', 'label']) &&
      isText(entry.expr, LIMITS.expression) &&
      (entry.label === undefined || isText(entry.label, 40))
    ) {
      functions.push({ expr: entry.expr, label: entry.label });
    } else {
      return fail('invalid_spec', 'functions');
    }
  }

  const x = json.x === undefined ? ([-10, 10] as [number, number]) : range(json.x);
  if (!x) return fail('invalid_spec', 'x');
  const y = json.y === undefined ? null : range(json.y);
  if (json.y !== undefined && !y) return fail('invalid_spec', 'y');

  const points: GraphSpec['points'] = [];
  if (json.points !== undefined) {
    if (!Array.isArray(json.points) || json.points.length > 20)
      return fail('invalid_spec', 'points');
    for (const point of json.points) {
      if (
        !isObject(point) ||
        !hasOnly(point, ['x', 'y', 'label']) ||
        !isFiniteNumber(point.x) ||
        !isFiniteNumber(point.y) ||
        (point.label !== undefined && !isText(point.label, 40))
      ) {
        return fail('invalid_spec', 'points');
      }
      points.push({ x: point.x, y: point.y, label: point.label });
    }
  }

  if (json.grid !== undefined && typeof json.grid !== 'boolean')
    return fail('invalid_spec', 'grid');
  return ok({ functions, x, y, points, grid: json.grid ?? true });
}
