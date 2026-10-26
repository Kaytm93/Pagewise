import { RenderError } from './errors';

/**
 * Valenzprüfung für SMILES in der Schulchemie. SmilesDrawer prüft nur die Schreibweise: `C(C)(C)(C)(C)C` mit fünf
 * Bindungen an einem Kohlenstoff geht dort durch. Diese Prüfung liest dieselbe Angabe und zählt die Bindungen je
 * Atom. Sie ist bewusst eng:
 * - Zu wenige Bindungen sind erlaubt: Wasserstoff wird ergänzt, Radikale wie `[CH3]` bleiben möglich.
 * - Aromatische Atome und Bindungen (Kleinbuchstaben, `:`) werden übersprungen, dafür bräuchte es die Kekulé-Struktur.
 * - Atome mit Ladung werden übersprungen, ihre Wertigkeit hängt von der Ladung ab.
 * - Elemente außerhalb der Tabelle (Metalle, Silicium) werden ebenfalls übersprungen.
 *
 * Die Prüfung gibt nur feste Codes zurück, nie Text aus der Angabe.
 */

/** Höchstzahl der Bindungen je Atom ohne Ladung. */
const MAX_BONDS = new Map<string, number>([
  ['H', 1],
  ['B', 3],
  ['C', 4],
  ['N', 3],
  ['O', 2],
  ['P', 5],
  ['S', 6],
  ['F', 1],
  ['Cl', 1],
  ['Br', 1],
  ['I', 1],
]);

/** Bindungssymbole mit ihrer Ordnung. Die aromatische Bindung `:` steht nicht hier, sie wird gesondert behandelt. */
const BOND_ORDER = new Map<string, number>([
  ['-', 1],
  ['/', 1],
  ['\\', 1],
  ['=', 2],
  ['#', 3],
  ['$', 4],
]);

/** Ein Token der Angabe: Klammeratom, Organ-Atom, Ringschluss, Bindung, Verzweigung oder Punkt. */
const TOKEN = /\[[^\]]+\]|Br|Cl|%\d\d|[BCNOPSFIbcnops*]|\d|[-=#$:/\\]|[().]/y;
const RING = /^(\d|%\d\d)$/;
/** Klammeratom: Isotop, Element, Chiralität, Wasserstoffe, Ladung, Klasse. */
const BRACKET =
  /^\[(\d*)([A-Z][a-z]?|[a-z]{1,2}|\*)(@{1,2}|@(?:TH|AL|SP|TB|OH)\d+)?(H\d*)?([+-]+\d*)?(:\d+)?\]$/;

interface Atom {
  symbol: string;
  aromatic: boolean;
  charged: boolean;
  hydrogens: number;
  /** Je Bindung ihre Ordnung. Aromatische Bindungen zählen als 1. */
  bonds: number[];
  aromaticBond: boolean;
}

function newAtom(symbol: string, charged: boolean, hydrogens: number): Atom {
  return {
    symbol,
    aromatic: /^[a-z]/.test(symbol),
    charged,
    hydrogens,
    bonds: [],
    aromaticBond: false,
  };
}

function readAtom(token: string): Atom | null {
  if (!token.startsWith('[')) return newAtom(token, false, 0);
  const match = BRACKET.exec(token);
  if (!match) return null;
  const hydrogen = match[4];
  const hydrogens =
    hydrogen === undefined ? 0 : hydrogen.length > 1 ? Number(hydrogen.slice(1)) : 1;
  return newAtom(match[2] ?? '', match[5] !== undefined, hydrogens);
}

/** Verbindet zwei Atome. Ohne Symbol ist die Bindung einfach, außer zwischen zwei aromatischen Atomen. */
function connect(left: Atom, right: Atom, symbol: string | null): void {
  const aromatic = symbol === ':' || (symbol === null && left.aromatic && right.aromatic);
  const order = aromatic ? 1 : (BOND_ORDER.get(symbol ?? '-') ?? 1);
  left.bonds.push(order);
  right.bonds.push(order);
  if (aromatic) {
    left.aromaticBond = true;
    right.aromaticBond = true;
  }
}

/**
 * Zerlegt die Angabe in Atome, in der Reihenfolge der Angabe. `null`, wenn sie so nicht zerlegt werden kann (offene
 * Klammer oder Ring, Bindung ohne Atom). Die Schreibweise hat SmilesDrawer schon geprüft; das fängt Fälle ab, die
 * SmilesDrawer durchlässt, etwa einen Ring, der nicht geschlossen wird.
 */
function readAtoms(smiles: string): Atom[] | null {
  const atoms: Atom[] = [];
  const branches: Atom[] = [];
  const rings = new Map<string, { atom: Atom; symbol: string | null }>();
  let current: Atom | null = null;
  let pending: string | null = null;
  let pos = 0;

  while (pos < smiles.length) {
    TOKEN.lastIndex = pos;
    const match = TOKEN.exec(smiles);
    if (!match) return null;
    const token = match[0];
    pos += token.length;

    if (token === '(') {
      if (!current || pending !== null) return null;
      branches.push(current);
    } else if (token === ')') {
      const back = branches.pop();
      if (!back || pending !== null) return null;
      current = back;
    } else if (token === '.') {
      if (pending !== null) return null;
      current = null;
    } else if (BOND_ORDER.has(token) || token === ':') {
      if (pending !== null) return null;
      pending = token;
    } else if (RING.test(token)) {
      if (!current) return null;
      const open = rings.get(token);
      if (!open) {
        rings.set(token, { atom: current, symbol: pending });
      } else {
        if (open.atom === current) return null;
        rings.delete(token);
        connect(open.atom, current, pending ?? open.symbol);
      }
      pending = null;
    } else {
      const atom = readAtom(token);
      if (!atom || (!current && pending !== null)) return null;
      atoms.push(atom);
      if (current) connect(current, atom, pending);
      current = atom;
      pending = null;
    }
  }

  if (branches.length > 0 || rings.size > 0 || pending !== null || atoms.length === 0) return null;
  return atoms;
}

/** Hat das Atom mehr Bindungen (und Wasserstoffe in Klammern), als die Schulchemie erlaubt? */
function overfilled(atom: Atom): boolean {
  const max = MAX_BONDS.get(atom.symbol);
  if (max === undefined || atom.aromatic || atom.aromaticBond || atom.charged) return false;
  const bonds = atom.bonds.reduce((sum, order) => sum + order, 0);
  return bonds + atom.hydrogens > max;
}

/**
 * `null`, wenn jedes Atom im erlaubten Rahmen liegt. Sonst `invalid_valence` mit der Nummer des ersten zu vollen
 * Atoms (ab 1, in der Reihenfolge der Angabe) oder `invalid_smiles`, wenn die Angabe nicht zerlegt werden kann.
 */
export function checkSmilesValence(smiles: string): RenderError | null {
  const atoms = readAtoms(smiles.trim());
  if (!atoms) return new RenderError('invalid_smiles');
  const index = atoms.findIndex(overfilled);
  return index === -1 ? null : new RenderError('invalid_valence', `Atom ${index + 1}`);
}
