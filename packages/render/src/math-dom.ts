import { katexHtml } from './math';
import { sanitizeMathHtml } from './sanitize';

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

/** Je herausgenommener Stilangabe: ihre Nummer (Marke `data-pgs` am Element) und die Eigenschaften. */
export type InlineStyles = [id: number, declarations: [string, string][]][];

// Ein öffnendes Tag mit seinen Attributen. KaTeX schreibt Attribute immer in doppelten Anführungszeichen und
// setzt `<`, `>` und `"` in Werten um, deshalb genügt diese Form für seine Ausgabe.
const OPENING_TAG =
  /<([a-zA-Z][\w:-]*)((?:\s+[^\s"'=<>`/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
const STYLE_ATTRIBUTE = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/**
 * KaTeX setzt `style`-Attribute, die unsere CSP (`style-src 'self'`) blockiert. Diese Funktion nimmt sie aus
 * dem HTML-Text heraus und gibt sie getrennt zurück: `html` enthält keine Stilangaben mehr, jedes betroffene
 * Element trägt stattdessen die Marke `data-pgs="<Nummer>"`, und `styles` nennt je Nummer die Eigenschaften
 * aus einer festen Liste. Nach dem Einhängen setzt `applyInlineStyles` sie über das CSSOM, das die CSP erlaubt.
 *
 * Das passiert absichtlich auf dem Text und nicht über `DOMParser`: Schon das Parsen eines Elements mit
 * `style`-Attribut meldet in der Konsole einen Verstoß gegen die CSP, auch in einem unsichtbaren Dokument.
 */
export function extractInlineStyles(html: string): { html: string; styles: InlineStyles } {
  const styles: InlineStyles = [];
  const clean = html.replace(
    OPENING_TAG,
    (tag, name: string, attributes: string, close: string) => {
      const found = STYLE_ATTRIBUTE.exec(attributes);
      if (!found) return tag;
      const raw = found[1] ?? found[2] ?? '';
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
      const rest = attributes.replace(STYLE_ATTRIBUTE, '');
      if (declarations.length === 0) return `<${name}${rest}${close}>`;
      styles.push([styles.length, declarations]);
      return `<${name}${rest} data-pgs="${styles.length - 1}"${close}>`;
    },
  );
  return { html: clean, styles };
}

/** Setzt die herausgenommenen Stilangaben über das CSSOM und entfernt die Marken. */
export function applyInlineStyles(root: Element, styles: InlineStyles): void {
  const byId = new Map(styles);
  for (const element of root.querySelectorAll('[data-pgs]')) {
    const declarations = byId.get(Number(element.getAttribute('data-pgs')));
    element.removeAttribute('data-pgs');
    if (!declarations) continue;
    if (element instanceof HTMLElement || element instanceof SVGElement) {
      for (const [property, value] of declarations) element.style.setProperty(property, value);
    }
  }
}

/**
 * Zeichnet eine Formel in `host`: KaTeX, dann bereinigen, Stilangaben herauslösen, Text einsetzen und die
 * Stilangaben über das CSSOM setzen (die CSP blockiert `style`-Attribute, nicht das CSSOM). Der alte Inhalt von
 * `host` wird ersetzt. Wirft `RenderError`; dann bleibt `host` unverändert.
 */
export function renderMathInto(host: Element, latex: string, display: boolean): void {
  const { html, styles } = extractInlineStyles(katexHtml(latex, display));
  host.innerHTML = sanitizeMathHtml(html);
  applyInlineStyles(host, styles);
}
