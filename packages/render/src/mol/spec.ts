import { fail, hasControlChars, LIMITS, ok, type Result } from '../errors';

export interface MolSpec {
  kind: 'formula' | 'smiles';
  /** Summenformel (`H2O`) oder SMILES-Zeichenkette. */
  value: string;
  /** Beschriftung unter der Struktur: `undefined` = Summenformel, `null` = keine. */
  caption: string | null | undefined;
  angles: boolean;
  lonePairs: boolean;
}

const SUBSCRIPTS: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
};

/** `H₂O` und `H2O` meinen dasselbe: tiefgestellte Zahlen auflösen, Leerzeichen und Klammern der Schreibweise entfernen. */
export function canonicalFormula(value: string): string {
  return value.replace(/[₀-₉]/g, (c) => SUBSCRIPTS[c] ?? c).replace(/[\s_{}]/g, '');
}

const KEYS: Record<string, 'formula' | 'smiles' | 'caption' | 'angles' | 'lonePairs'> = {
  formula: 'formula',
  formel: 'formula',
  summenformel: 'formula',
  smiles: 'smiles',
  caption: 'caption',
  beschriftung: 'caption',
  angles: 'angles',
  winkel: 'angles',
  lonepairs: 'lonePairs',
  elektronenpaare: 'lonePairs',
};

const truthy = (value: string): boolean | null => {
  const v = value.trim().toLowerCase();
  if (['ja', 'an', 'on', 'true', '1'].includes(v)) return true;
  if (['nein', 'aus', 'off', 'false', '0'].includes(v)) return false;
  return null;
};

/**
 * Aufbau eines ` ```mol `-Blocks. Kurzform: eine Zeile mit der Summenformel (`H2O`). Mit Schlüsseln, je Zeile
 * `schlüssel: wert`: `formel` (Summenformel für Schulmoleküle mit Valenzstrichformel) oder `smiles` (SMILES für
 * organische Strukturen als Skelettformel), dazu `beschriftung` (Text oder `aus`), `winkel` und
 * `elektronenpaare` (`ja` oder `nein`).
 */
export function parseMolSpec(source: string): Result<MolSpec> {
  const text = source.trim();
  if (text === '') return fail('empty');
  if (text.length > LIMITS.mol) return fail('too_large');
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const spec: MolSpec = {
    kind: 'formula',
    value: '',
    caption: undefined,
    angles: true,
    lonePairs: true,
  };
  let seen = false;

  if (lines.length === 1 && !(lines[0] as string).includes(':')) {
    spec.value = canonicalFormula(lines[0] as string);
    seen = true;
  } else {
    for (const line of lines) {
      const colon = line.indexOf(':');
      if (colon === -1) return fail('invalid_spec');
      const key = KEYS[line.slice(0, colon).trim().toLowerCase()];
      const value = line.slice(colon + 1).trim();
      if (!key) return fail('invalid_spec', 'key');
      if (key === 'formula' || key === 'smiles') {
        if (seen) return fail('invalid_spec', 'formula');
        seen = true;
        spec.kind = key;
        spec.value = key === 'formula' ? canonicalFormula(value) : value;
      } else if (key === 'caption') {
        const off = truthy(value) === false;
        spec.caption = off ? null : value.slice(0, 40);
      } else {
        const flag = truthy(value);
        if (flag === null) return fail('invalid_spec', key);
        spec[key] = flag;
      }
    }
  }
  if (!seen || spec.value === '') return fail('invalid_spec', 'formula');
  if (hasControlChars(spec.value) || (spec.caption && hasControlChars(spec.caption))) {
    return fail('invalid_spec');
  }
  return ok(spec);
}
