import { renderBlock, type SvgBlockKind } from './render';

/**
 * Abbildungen für Dateien (PDF, PPTX): Die Zeichner liefern SVG, dessen Farben im Chat über CSS-Klassen und
 * `currentColor` kommen. Eine Datei hat kein CSS der App und steht auf weißem Grund. Darum bekommt jedes Element
 * seine Druckfarben als Attribute (keine Style-Elemente, die CSP gilt auch für eingebettete Stile), und das
 * Bild wird auf eine Leinwand gezeichnet (D-075). Das Ergebnis ist ein PNG als Daten-Adresse.
 */

const INK = '#1f1f1f';
const MUTED = '#5a5a5a';
const DASH = '7 5';

/** Druckfarben je Klasse (Spiegel von `styles/blocks.css`, ohne Themenfarben). */
const PRINT: Record<string, Record<string, string>> = {
  'pg-grid': { stroke: '#c9c9c9', 'stroke-width': '1', fill: 'none' },
  'pg-axis': { stroke: MUTED, 'stroke-width': '1.4' },
  'pg-tick': { stroke: MUTED, 'stroke-width': '1' },
  'pg-label': { fill: MUTED },
  'pg-fn-0': { stroke: INK },
  'pg-fn-1': { stroke: '#1a5fb4' },
  'pg-fn-2': { stroke: '#c01c28' },
  'pg-fn-3': { stroke: INK, 'stroke-dasharray': DASH },
  'pg-fn-4': { stroke: '#1a5fb4', 'stroke-dasharray': DASH },
  'pg-fn-5': { stroke: '#c01c28', 'stroke-dasharray': DASH },
  'pg-point': { fill: INK },
  'pg-atom': { fill: INK },
  'pg-bond': { stroke: INK },
  'pg-dash': { stroke: INK },
  'pg-lp': { stroke: INK },
  'pg-wedge': { fill: INK },
  'pg-angle': { stroke: MUTED },
  'pg-caption': { fill: MUTED },
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT = 'Arial, Helvetica, sans-serif';

export interface Raster {
  /** PNG als Daten-Adresse. */
  dataUrl: string;
  /** Breite zu Höhe (größer als 1: breiter als hoch). */
  ratio: number;
  /** Größe der Zeichnung vor dem Vergrößern, in der Einheit des SVG (Pixel). Für die natürliche Größe auf der Seite. */
  width: number;
  height: number;
}

function numberOf(value: string | null): number | null {
  if (value === null || value.endsWith('%')) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Größe der Zeichnung: Attribute `width`/`height`, sonst der `viewBox`. */
function sizeOf(root: Element): { width: number; height: number } | null {
  const box = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const fromBox =
    box && box.length === 4 && box[2] && box[3] ? { width: box[2], height: box[3] } : null;
  const width = numberOf(root.getAttribute('width')) ?? fromBox?.width ?? null;
  const height = numberOf(root.getAttribute('height')) ?? fromBox?.height ?? null;
  return width && height ? { width, height } : null;
}

/**
 * Macht aus einem SVG des Chats ein eigenständiges SVG für die Datei: Druckfarben als Attribute, `currentColor`
 * ersetzt, feste Größe, Namensraum, einheitliche Schrift. Gibt `null` zurück, wenn der Text kein SVG ist.
 */
export function printSvg(svg: string): { text: string; width: number; height: number } | null {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  if (root?.localName !== 'svg' || document.querySelector('parsererror')) return null;
  const size = sizeOf(root);
  if (!size) return null;

  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const name of ['class']) {
      for (const token of (element.getAttribute(name) ?? '').split(/\s+/)) {
        const attributes = PRINT[token];
        if (!attributes) continue;
        for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      }
    }
    for (const key of ['fill', 'stroke', 'color']) {
      if (element.getAttribute(key)?.toLowerCase() === 'currentcolor')
        element.setAttribute(key, INK);
    }
    if (element.hasAttribute('font-family')) element.setAttribute('font-family', FONT);
  }
  root.setAttribute('xmlns', SVG_NS);
  root.setAttribute('width', String(size.width));
  root.setAttribute('height', String(size.height));
  if (!root.hasAttribute('viewBox'))
    root.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
  root.setAttribute('color', INK);
  return { text: new XMLSerializer().serializeToString(root), ...size };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('raster: Bild nicht lesbar'));
    image.src = url;
  });
}

/** Größte Kantenlänge der Leinwand in Pixeln: groß genug für Druck, klein genug für Telefone. */
const MAX_EDGE = 2400;

/**
 * Zeichnet einen Block (Graph, Molekül, Noten) wie im Chat und macht daraus ein PNG auf weißem Grund. `scale`
 * vergrößert gegenüber der Größe des SVG (Standard 3, höchstens {@link MAX_EDGE} Pixel an der längsten Kante).
 */
export async function rasterizeBlock(
  kind: SvgBlockKind,
  source: string,
  scale = 3,
): Promise<Raster> {
  const printed = printSvg(await renderBlock(kind, source));
  if (!printed) throw new Error('raster: kein SVG');
  const factor = Math.min(scale, MAX_EDGE / Math.max(printed.width, printed.height));
  const width = Math.max(1, Math.round(printed.width * factor));
  const height = Math.max(1, Math.round(printed.height * factor));

  const url = URL.createObjectURL(
    new Blob([printed.text], { type: 'image/svg+xml;charset=utf-8' }),
  );
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('raster: keine Leinwand');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      ratio: printed.width / printed.height,
      width: printed.width,
      height: printed.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Zeichenblock-Art einer Abbildung. */
export function blockKindOf(kind: 'graph' | 'mol' | 'abc'): SvgBlockKind {
  return kind;
}
