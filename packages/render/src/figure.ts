import { fail, hasControlChars, LIMITS, ok, type Result } from './errors';
import { validateGraph } from './graph';
import { parseMolSpec, validateFormulaSpec } from './mol';

/**
 * Eine Abbildung in einem Dokument oder auf einer Folie (D-075): ein Funktionsgraph, ein Molekül (Valenzstrich
 * oder SMILES) oder Noten. Gespeichert ist der Quelltext des jeweiligen Blocks (`source`), gezeichnet wird er
 * mit denselben Zeichnern wie im Chat. Die Formen unten sind die Eingabe des Modells; geprüft und gespeichert
 * wird immer die einheitliche Form `{ type: 'figure', kind, source, caption? }`.
 */
export type FigureKind = 'graph' | 'mol' | 'abc';

export interface Figure {
  type: 'figure';
  kind: FigureKind;
  /** Quelltext des Blocks: Graph-JSON, Summenformel oder "smiles: …", ABC-Notation. */
  source: string;
  caption: string | undefined;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnly = (value: Json, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

/** Eingabeart (`type`) und ihr Feldname für den Inhalt. */
const INPUT = {
  graph: { kind: 'graph', keys: ['graph', 'source'] },
  molecule: { kind: 'mol', keys: ['formula', 'smiles', 'source'] },
  notes: { kind: 'abc', keys: ['abc', 'source'] },
} as const;

/** `true`, wenn der Eintrag eine Abbildung beschreibt (Eingabeform oder einheitliche Form). */
export function isFigureEntry(entry: unknown): boolean {
  return isObject(entry) && typeof entry.type === 'string' && FIGURE_TYPES.includes(entry.type);
}

/** Alle Namen für `type`, die eine Abbildung beschreiben. */
export const FIGURE_TYPES: readonly string[] = ['figure', ...Object.keys(INPUT)];

/**
 * Liest eine Abbildung. `readCaption` prüft die Bildunterschrift nach den Regeln des Ziels (das PDF kennt nicht
 * jedes Zeichen). Prüft Form und Größe sofort; ob die Notation sich zeichnen lässt, prüft `validateFigureSource`
 * (SMILES und Noten brauchen die schweren Bibliotheken, also asynchron).
 */
export function readFigure(
  entry: Json,
  readCaption: (value: unknown) => Result<string>,
): Result<Figure> {
  const type = entry.type;
  let kind: FigureKind;
  let source: string;

  if (type === 'figure') {
    if (!hasOnly(entry, ['type', 'kind', 'source', 'caption']))
      return fail('invalid_spec', 'figure');
    if (entry.kind !== 'graph' && entry.kind !== 'mol' && entry.kind !== 'abc') {
      return fail('invalid_spec', 'kind');
    }
    kind = entry.kind;
    if (typeof entry.source !== 'string') return fail('invalid_spec', 'source');
    source = entry.source;
  } else if (typeof type === 'string' && Object.hasOwn(INPUT, type)) {
    const input = INPUT[type as keyof typeof INPUT];
    if (!hasOnly(entry, ['type', ...input.keys, 'caption'])) return fail('invalid_spec', type);
    kind = input.kind;
    const given = input.keys.filter((key) => entry[key] !== undefined);
    if (given.length !== 1) return fail('invalid_spec', type);
    const key = given[0] as string;
    const value = entry[key];
    if (kind === 'graph') {
      if (typeof value === 'string') source = value;
      else if (isObject(value)) source = JSON.stringify(value);
      else return fail('invalid_spec', key);
    } else if (typeof value !== 'string') {
      return fail('invalid_spec', key);
    } else if (key === 'smiles') {
      source = `smiles: ${value.trim()}`;
    } else {
      source = value;
    }
  } else {
    return fail('invalid_spec', 'type');
  }

  const limit = kind === 'graph' ? LIMITS.graph : kind === 'mol' ? LIMITS.mol : LIMITS.abc;
  if (source.trim() === '') return fail('empty', kind);
  if (source.length > limit) return fail('too_large', kind);
  if (hasControlChars(source)) return fail('invalid_spec', kind);

  // Sofort prüfbar, ohne schwere Bibliothek: Graph und Summenformel. SMILES und Noten prüft der zweite Schritt.
  if (kind === 'graph') {
    const error = validateGraph(source);
    if (error) return { ok: false, error };
  } else if (kind === 'mol') {
    if (source.includes('\n')) return fail('invalid_spec', 'mol');
    const spec = parseMolSpec(source);
    if (!spec.ok) return spec;
    if (spec.value.kind !== 'smiles') {
      const error = validateFormulaSpec(spec.value);
      if (error) return { ok: false, error };
    }
  }

  let caption: string | undefined;
  if (entry.caption !== undefined) {
    const read = readCaption(entry.caption);
    if (!read.ok) return read;
    caption = read.value;
  }
  return ok({ type: 'figure', kind, source, caption });
}
