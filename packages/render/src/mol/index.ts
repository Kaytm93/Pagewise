import { RenderError } from '../errors';
import { renderFormulaSvg, renderMoleculeSvg } from './draw';
import { KNOWN_FORMULAS, MOLECULES, type Molecule } from './library';
import { type MolSpec, parseMolSpec } from './spec';

export { renderFormulaSvg, renderMoleculeSvg, withSubscripts } from './draw';
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

/** Eine Formel aus Elementen und Ziffern, Klammern erlaubt (`AgNO3`, `Ca(OH)2`). Kleinbuchstaben nur hinter einem Element. */
const FORMULA_SHAPE = /^(?:[A-Z][a-z]?\d*|[()]\d*)+$/;

/**
 * Eine Summenformel ohne Tabelleneintrag, die als Text gezeichnet wird: Salze und anorganische Stoffe (AgNO3,
 * CaCO3). Organische Formeln mit Kohlenstoff und Wasserstoff (C8H18) bleiben beim Fehler, dafür gibt es SMILES.
 */
function isPlainFormula(value: string): boolean {
  if (value.length > 40 || !FORMULA_SHAPE.test(value)) return false;
  const elements: string[] = value.match(/[A-Z][a-z]?/g) ?? [];
  return !(elements.includes('C') && elements.includes('H'));
}

/**
 * Zeichnet eine Summenformel: aus der Tabelle als Valenzstrichformel, sonst als Text, wenn sie ein Salz oder
 * anorganischer Stoff ist. Wirft `RenderError`: `unknown_formula` sonst (der Fehler nennt die Formel, damit das
 * Modell stattdessen SMILES nehmen kann).
 */
export function renderFormula(spec: MolSpec): string {
  const molecule = findMolecule(spec.value);
  if (molecule) {
    return renderMoleculeSvg(molecule, {
      angles: spec.angles,
      lonePairs: spec.lonePairs,
      caption: spec.caption,
      formula: spec.value,
    });
  }
  if (isPlainFormula(spec.value)) return renderFormulaSvg(spec.value);
  throw new RenderError('unknown_formula', safeName(spec.value));
}

/** Prüft einen ` ```mol `-Block mit Summenformel ohne zu zeichnen (SMILES prüft `@pagewise/render/smiles`). */
export function validateFormulaSpec(spec: MolSpec): RenderError | null {
  if (spec.kind !== 'formula' || findMolecule(spec.value) || isPlainFormula(spec.value))
    return null;
  return new RenderError('unknown_formula', safeName(spec.value));
}

export { parseMolSpec as parseMol };
export const KNOWN_FORMULA_LIST = KNOWN_FORMULAS.join(', ');
