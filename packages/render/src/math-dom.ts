/**
 * Der Teil der Formeldarstellung, der ein DOM braucht (Browser, Worker mit Seite, jsdom): Stilangaben von KaTeX
 * herauslösen und über das CSSOM setzen. Getrennt von `math.ts`, damit der Server Formeln prüfen kann, ohne
 * DOM-Typen zu brauchen.
 */

/** Eigenschaften, die KaTeX als Stilangabe setzt und die wir übernehmen (alles andere wird verworfen). */
const STYLE_PROPERTIES = new Set([
  'height',
  'width',
  'min-width',
  'top',
  'left',
  'vertical-align',
  'margin-left',
  'margin-right',
  'padding-left',
  'padding-right',
  'border-bottom-width',
  'border-right-width',
  'border-top-width',
  'border-left-width',
  'border-bottom-style',
  'border-right-style',
  'border-top-style',
  'border-left-style',
  'color',
]);
/** Ein Wert ist eine Zahl mit Einheit oder ein einzelnes Wort bzw. eine Hexfarbe: keine Klammern, keine Adressen. */
const STYLE_VALUE = /^(?:-?\d*\.?\d+[a-z%]{0,3}|#[0-9a-f]{3,8}|[a-z-]{1,24})$/i;

export type InlineStyles = [index: number, declarations: [string, string][]][];

/**
 * KaTeX setzt `style`-Attribute, die unsere CSP (`style-src 'self'`) blockiert. Diese Funktion nimmt sie aus
 * dem HTML heraus und gibt sie getrennt zurück: `html` enthält keine Stilangaben mehr, `styles` nennt je
 * Element (Nummer in Dokumentreihenfolge aller Elemente) die Eigenschaften aus einer festen Liste. Nach dem
 * Einhängen setzt `applyInlineStyles` sie über das CSSOM, das die CSP erlaubt.
 *
 * Braucht ein DOM (`DOMParser`): Browser, Worker mit Seite, jsdom.
 */
export function extractInlineStyles(html: string): { html: string; styles: InlineStyles } {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const styles: InlineStyles = [];
  const elements = doc.body.querySelectorAll('*');
  elements.forEach((element, index) => {
    const raw = element.getAttribute('style');
    if (raw === null) return;
    element.removeAttribute('style');
    const declarations: [string, string][] = [];
    for (const part of raw.split(';')) {
      const colon = part.indexOf(':');
      if (colon === -1) continue;
      const property = part.slice(0, colon).trim().toLowerCase();
      const value = part.slice(colon + 1).trim();
      if (STYLE_PROPERTIES.has(property) && STYLE_VALUE.test(value)) {
        declarations.push([property, value]);
      }
    }
    if (declarations.length > 0) styles.push([index, declarations]);
  });
  return { html: doc.body.innerHTML, styles };
}

/** Setzt die herausgenommenen Stilangaben über das CSSOM. `root` ist das Element, in das das HTML kam. */
export function applyInlineStyles(root: Element, styles: InlineStyles): void {
  const elements = root.querySelectorAll('*');
  for (const [index, declarations] of styles) {
    const element = elements[index];
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
    for (const [property, value] of declarations) element.style.setProperty(property, value);
  }
}
