import { RenderError } from '../errors';
import { renderMoleculeSvg } from './draw';
import { KNOWN_FORMULAS, MOLECULES, type Molecule } from './library';
import { type MolSpec, parseMolSpec } from './spec';

export { renderMoleculeSvg, withSubscripts } from './draw';
export { KNOWN_FORMULAS, MOLECULES, type Molecule } from './library';
export { canonicalFormula, type MolSpec, parseMolSpec } from './spec';

const BY_LOWER = new Map(
  Object.entries(MOLECULES).map(([key, molecule]) => [key.toLowerCase(), molecule]),
);

/**
 * Sucht eine Summenformel in der Tabelle: erst genau, dann ohne Groß- und Kleinschreibung (`h2o`). Mit Map
 * statt Objektzugriff, damit ein Name wie `constructor` nichts aus dem Prototyp trifft.
 */
export function findMolecule(formula: string): Molecule | undefined {
  return Object.hasOwn(MOLECULES, formula)
    ? MOLECULES[formula]
    : BY_LOWER.get(formula.toLowerCase());
}

/** Zeichenfolge aus Buchstaben und Ziffern, höchstens 12 Zeichen: sicher für eine Fehlermeldung. */
const safeName = (value: string) => value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);

/**
 * Zeichnet eine Summenformel aus der Tabelle. Wirft `RenderError`: `unknown_formula`, wenn sie dort nicht
 * steht (der Fehler nennt die Formel, damit das Modell stattdessen SMILES nehmen kann).
 */
export function renderFormula(spec: MolSpec): string {
  const molecule = findMolecule(spec.value);
  if (!molecule) throw new RenderError('unknown_formula', safeName(spec.value));
  return renderMoleculeSvg(molecule, {
    angles: spec.angles,
    lonePairs: spec.lonePairs,
    caption: spec.caption,
    formula: spec.value,
  });
}

/** Prüft einen ` ```mol `-Block mit Summenformel ohne zu zeichnen (SMILES prüft `@pagewise/render/smiles`). */
export function validateFormulaSpec(spec: MolSpec): RenderError | null {
  return spec.kind === 'formula' && !findMolecule(spec.value)
    ? new RenderError('unknown_formula', safeName(spec.value))
    : null;
}

export { parseMolSpec as parseMol };
export const KNOWN_FORMULA_LIST = KNOWN_FORMULAS.join(', ');
