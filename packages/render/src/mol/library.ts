/**
 * Bekannte Schulmoleküle mit Valenzstrichformel: Atome mit Lage, Bindungen (Strich, Doppel-, Dreifachstrich,
 * Keil für „zum Betrachter“, gestrichelt für „vom Betrachter weg“) und freie Elektronenpaare als Strich.
 * Längen in Bindungslängen, Winkel in Grad (mathematisch: 0 nach rechts, 90 nach oben).
 *
 * Bewusst keine Koordinaten vom Modell: Modelle liefern Winkel und Strukturen oft falsch. Das Modell nennt
 * die Summenformel, die Geometrie steht hier. Was nicht in der Tabelle steht, geht (für organische
 * Strukturen) als SMILES an die Skelettformel-Zeichnung.
 */
export interface Atom {
  el: string;
  x: number;
  y: number;
  /** Richtungen (Grad) der freien Elektronenpaare, je eine pro Paar. */
  lp: number[];
}

export interface Bond {
  a: number;
  b: number;
  order: 1 | 2 | 3;
  style?: 'wedge' | 'dash';
}

export interface AngleMark {
  center: number;
  from: number;
  to: number;
  text: string;
}

export interface Molecule {
  atoms: Atom[];
  bonds: Bond[];
  angles: AngleMark[];
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Freie Paare eines Atoms mit nur einer Bindung: Richtung „nach außen“ und seitlich davon. */
const lpOut = (out: number, count: 1 | 2 | 3): number[] =>
  count === 1 ? [out] : count === 2 ? [out - 60, out + 60] : [out, out - 90, out + 90];

interface Ligand {
  el: string;
  angle: number;
  order?: 1 | 2 | 3;
  style?: 'wedge' | 'dash';
  lp?: 1 | 2 | 3;
}

/** Zentralatom im Ursprung, Liganden im Abstand 1 in den angegebenen Richtungen. */
function star(
  center: string,
  centerLp: number[],
  ligands: Ligand[],
  angles: AngleMark[] = [],
): Molecule {
  const atoms: Atom[] = [{ el: center, x: 0, y: 0, lp: centerLp }];
  const bonds: Bond[] = [];
  ligands.forEach((ligand, i) => {
    atoms.push({
      el: ligand.el,
      x: Math.cos(rad(ligand.angle)),
      y: Math.sin(rad(ligand.angle)),
      lp: ligand.lp ? lpOut(ligand.angle, ligand.lp) : [],
    });
    bonds.push({
      a: 0,
      b: i + 1,
      order: ligand.order ?? 1,
      ...(ligand.style && { style: ligand.style }),
    });
  });
  return { atoms, bonds, angles };
}

/** Zwei Atome nebeneinander (zweiatomige Moleküle, HCl). */
function pair(
  left: string,
  right: string,
  order: 1 | 2 | 3,
  leftLp: number[],
  rightLp: number[],
): Molecule {
  return {
    atoms: [
      { el: left, x: 0, y: 0, lp: leftLp },
      { el: right, x: 1, y: 0, lp: rightLp },
    ],
    bonds: [{ a: 0, b: 1, order }],
    angles: [],
  };
}

export const MOLECULES: Record<string, Molecule> = {
  H2: pair('H', 'H', 1, [], []),
  O2: pair('O', 'O', 2, [90, 270], [90, 270]),
  N2: pair('N', 'N', 3, [180], [0]),
  Cl2: pair('Cl', 'Cl', 1, [90, 270, 180], [90, 270, 0]),
  F2: pair('F', 'F', 1, [90, 270, 180], [90, 270, 0]),
  HCl: pair('H', 'Cl', 1, [], [90, 270, 0]),
  HF: pair('H', 'F', 1, [], [90, 270, 0]),
  H2O: star(
    'O',
    [50, 130],
    [
      { el: 'H', angle: 217.75 },
      { el: 'H', angle: 322.25 },
    ],
    [{ center: 0, from: 217.75, to: 322.25, text: '104,5°' }],
  ),
  H2S: star(
    'S',
    [50, 130],
    [
      { el: 'H', angle: 224 },
      { el: 'H', angle: 316 },
    ],
    [{ center: 0, from: 224, to: 316, text: '92°' }],
  ),
  NH3: star(
    'N',
    [90],
    [
      { el: 'H', angle: 205 },
      { el: 'H', angle: 335, style: 'wedge' },
      { el: 'H', angle: 270, style: 'dash' },
    ],
  ),
  CH4: star(
    'C',
    [],
    [
      { el: 'H', angle: 220 },
      { el: 'H', angle: 320 },
      { el: 'H', angle: 40, style: 'wedge' },
      { el: 'H', angle: 140, style: 'dash' },
    ],
  ),
  CO2: star(
    'C',
    [],
    [
      { el: 'O', angle: 180, order: 2, lp: 2 },
      { el: 'O', angle: 0, order: 2, lp: 2 },
    ],
  ),
  SO2: star(
    'S',
    [90],
    [
      { el: 'O', angle: 210, order: 2, lp: 2 },
      { el: 'O', angle: 330, order: 2, lp: 2 },
    ],
    [{ center: 0, from: 210, to: 330, text: '119°' }],
  ),
  CH2O: star(
    'C',
    [],
    [
      { el: 'O', angle: 90, order: 2, lp: 2 },
      { el: 'H', angle: 210 },
      { el: 'H', angle: 330 },
    ],
  ),
  HCN: {
    atoms: [
      { el: 'H', x: 0, y: 0, lp: [] },
      { el: 'C', x: 1, y: 0, lp: [] },
      { el: 'N', x: 2, y: 0, lp: [0] },
    ],
    bonds: [
      { a: 0, b: 1, order: 1 },
      { a: 1, b: 2, order: 3 },
    ],
    angles: [],
  },
  C2H2: {
    atoms: [
      { el: 'H', x: 0, y: 0, lp: [] },
      { el: 'C', x: 1, y: 0, lp: [] },
      { el: 'C', x: 2, y: 0, lp: [] },
      { el: 'H', x: 3, y: 0, lp: [] },
    ],
    bonds: [
      { a: 0, b: 1, order: 1 },
      { a: 1, b: 2, order: 3 },
      { a: 2, b: 3, order: 1 },
    ],
    angles: [],
  },
  C2H4: {
    atoms: [
      { el: 'C', x: 0, y: 0, lp: [] },
      { el: 'C', x: 1, y: 0, lp: [] },
      { el: 'H', x: Math.cos(rad(120)), y: Math.sin(rad(120)), lp: [] },
      { el: 'H', x: Math.cos(rad(240)), y: Math.sin(rad(240)), lp: [] },
      { el: 'H', x: 1 + Math.cos(rad(60)), y: Math.sin(rad(60)), lp: [] },
      { el: 'H', x: 1 + Math.cos(rad(300)), y: Math.sin(rad(300)), lp: [] },
    ],
    bonds: [
      { a: 0, b: 1, order: 2 },
      { a: 0, b: 2, order: 1 },
      { a: 0, b: 3, order: 1 },
      { a: 1, b: 4, order: 1 },
      { a: 1, b: 5, order: 1 },
    ],
    angles: [],
  },
};

/** Die bekannten Summenformeln (für Fehlermeldungen und Dokumentation). */
export const KNOWN_FORMULAS = Object.keys(MOLECULES);
