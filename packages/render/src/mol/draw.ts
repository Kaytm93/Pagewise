import type { AngleMark, Atom, Bond, Molecule } from './library';

const S = 54; // Pixel je Bindungslänge
const LABEL_R = 11; // so weit bleibt die Bindung vom Atomzeichen weg
const MARGIN = 36;

const rad = (deg: number) => (deg * Math.PI) / 180;
const n = (value: number) => (Math.round(value * 100) / 100).toString();
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const SUB = '₀₁₂₃₄₅₆₇₈₉';

/** `H2O` als `H₂O`: Ziffern nach einem Buchstaben werden tiefgestellt. */
export function withSubscripts(formula: string): string {
  return formula.replace(/(?<=[A-Za-z)])\d+/g, (digits) =>
    [...digits].map((d) => SUB[Number(d)] ?? d).join(''),
  );
}

/** Zeichenfläche: y wächst im Bild nach unten, in der Tabelle nach oben. */
const pt = (atom: Pick<Atom, 'x' | 'y'>): [number, number] => [atom.x * S, -atom.y * S];

function bondElements(bond: Bond, atoms: Atom[]): string[] {
  const a = atoms[bond.a] as Atom;
  const b = atoms[bond.b] as Atom;
  const [ax, ay] = pt(a);
  const [bx, by] = pt(b);
  const length = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / length;
  const uy = (by - ay) / length;
  const x1 = ax + ux * LABEL_R;
  const y1 = ay + uy * LABEL_R;
  const x2 = bx - ux * LABEL_R;
  const y2 = by - uy * LABEL_R;
  const nx = -uy;
  const ny = ux;
  const line = (offset: number) =>
    `<line class="pg-bond" stroke="currentColor" stroke-width="2" stroke-linecap="round" x1="${n(x1 + nx * offset)}" y1="${n(y1 + ny * offset)}" x2="${n(x2 + nx * offset)}" y2="${n(y2 + ny * offset)}"/>`;

  if (bond.style === 'wedge') {
    const w = 4.5;
    return [
      `<polygon class="pg-wedge" fill="currentColor" points="${n(x1)},${n(y1)} ${n(x2 + nx * w)},${n(y2 + ny * w)} ${n(x2 - nx * w)},${n(y2 - ny * w)}"/>`,
    ];
  }
  if (bond.style === 'dash') {
    const parts: string[] = [];
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / (steps + 1);
      const cx = x1 + (x2 - x1) * t;
      const cy = y1 + (y2 - y1) * t;
      const half = 0.8 + t * 4.2;
      parts.push(
        `<line class="pg-dash" stroke="currentColor" stroke-width="1.8" x1="${n(cx + nx * half)}" y1="${n(cy + ny * half)}" x2="${n(cx - nx * half)}" y2="${n(cy - ny * half)}"/>`,
      );
    }
    return parts;
  }
  if (bond.order === 1) return [line(0)];
  if (bond.order === 2) return [line(-2.8), line(2.8)];
  return [line(-4), line(0), line(4)];
}

/** Freies Elektronenpaar als kurzer Strich neben dem Atom, quer zur Blickrichtung. */
function lonePair(atom: Atom, angle: number): string {
  const [cx, cy] = pt(atom);
  const dx = Math.cos(rad(angle));
  const dy = -Math.sin(rad(angle));
  const px = cx + dx * 17;
  const py = cy + dy * 17;
  const tx = -dy * 5.5;
  const ty = dx * 5.5;
  return `<line class="pg-lp" stroke="currentColor" stroke-width="2" stroke-linecap="round" x1="${n(px - tx)}" y1="${n(py - ty)}" x2="${n(px + tx)}" y2="${n(py + ty)}"/>`;
}

function angleMark(mark: AngleMark, atoms: Atom[]): string[] {
  const [cx, cy] = pt(atoms[mark.center] as Atom);
  const r = 26;
  const at = (deg: number, radius: number): [number, number] => [
    cx + Math.cos(rad(deg)) * radius,
    cy - Math.sin(rad(deg)) * radius,
  ];
  const [sx, sy] = at(mark.from, r);
  const [ex, ey] = at(mark.to, r);
  const middle = (mark.from + mark.to) / 2;
  const [tx, ty] = at(middle, r + 15);
  return [
    `<path class="pg-angle" fill="none" stroke="currentColor" stroke-width="1" d="M${n(sx)} ${n(sy)}A${r} ${r} 0 0 0 ${n(ex)} ${n(ey)}"/>`,
    `<text class="pg-label" fill="currentColor" x="${n(tx)}" y="${n(ty + 4)}" text-anchor="middle" font-size="12">${escapeXml(mark.text)}</text>`,
  ];
}

export interface DrawOptions {
  angles: boolean;
  lonePairs: boolean;
  /** `undefined`: die Summenformel; `null`: keine Beschriftung. */
  caption: string | null | undefined;
  formula: string;
}

/**
 * Zeichnet eine Valenzstrichformel als SVG-Text: Atomzeichen, Bindungsstriche, freie Elektronenpaare als
 * Striche, auf Wunsch Bindungswinkel. Ohne Stilangaben und Skript; Aussehen über Klassen (`pg-*`) mit
 * `currentColor` als Rückfall.
 */
export function renderMoleculeSvg(molecule: Molecule, options: DrawOptions): string {
  const body: string[] = [];
  for (const bond of molecule.bonds) body.push(...bondElements(bond, molecule.atoms));
  for (const atom of molecule.atoms) {
    const [x, y] = pt(atom);
    body.push(
      `<text class="pg-atom" fill="currentColor" x="${n(x)}" y="${n(y + 6)}" text-anchor="middle" font-size="18" font-weight="500">${escapeXml(atom.el)}</text>`,
    );
    if (options.lonePairs) for (const angle of atom.lp) body.push(lonePair(atom, angle));
  }
  if (options.angles)
    for (const mark of molecule.angles) body.push(...angleMark(mark, molecule.atoms));

  const xs = molecule.atoms.map((atom) => pt(atom)[0]);
  const ys = molecule.atoms.map((atom) => pt(atom)[1]);
  const caption =
    options.caption === null ? null : (options.caption ?? withSubscripts(options.formula));
  const minX = Math.min(...xs) - MARGIN;
  const maxX = Math.max(...xs) + MARGIN;
  const minY = Math.min(...ys) - MARGIN;
  const maxY =
    Math.max(...ys) +
    MARGIN +
    (caption ? 26 : 0) +
    (options.angles && molecule.angles.length ? 16 : 0);
  if (caption) {
    body.push(
      `<text class="pg-caption" fill="currentColor" x="${n((minX + maxX) / 2)}" y="${n(maxY - 8)}" text-anchor="middle" font-size="14">${escapeXml(caption)}</text>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="pg-mol" viewBox="${n(minX)} ${n(minY)} ${n(maxX - minX)} ${n(maxY - minY)}" role="img" font-family="Inter, system-ui, sans-serif">${body.join('')}</svg>`;
}
