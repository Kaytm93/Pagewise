import DOMPurify from 'dompurify';
import { RenderError } from './errors';

/**
 * Bereinigung von SVG, das nicht aus diesem Paket selbst stammt (Bibliotheken wie abcjs und SmilesDrawer, später
 * auch Modellausgaben). Strikte Liste: Erlaubt sind nur SVG-Elemente der Standardliste von DOMPurify, nie
 * Skripte, Stilelemente, `foreignObject`, Verweise, Bilder, Animationen oder `use`. Attribute `style` und
 * alles mit `href` fallen weg (Stilangaben blockiert die CSP ohnehin, und ein Verweis könnte nach außen
 * zeigen), `on…`-Attribute entfernt DOMPurify selbst. Die eigenen Zeichnungen (Graph, Molekül) enthalten
 * nichts davon und laufen trotzdem hindurch, damit es einen einzigen Weg gibt.
 *
 * `win` ist das Fenster, in dem bereinigt wird (Browser: `window`; Tests: jsdom).
 */
const FORBID_TAGS = [
  'style',
  'script',
  'foreignObject',
  'use',
  'image',
  'a',
  'animate',
  'animateMotion',
  'animateTransform',
  'set',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'textarea',
  'button',
];
const FORBID_ATTR = ['style', 'href', 'xlink:href', 'src', 'srcset', 'action', 'formaction'];

const MAX_SVG = 2_000_000;

export function sanitizeSvg(svg: string, win: Window & typeof globalThis = window): string {
  if (svg.length > MAX_SVG) throw new RenderError('too_large');
  const purifier = DOMPurify(win);
  const clean = purifier.sanitize(svg, {
    USE_PROFILES: { svg: true },
    FORBID_TAGS,
    FORBID_ATTR,
    ADD_ATTR: ['role'],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: false,
    RETURN_TRUSTED_TYPE: false,
  });
  const text = String(clean);
  if (!text.trimStart().startsWith('<svg')) throw new RenderError('render_failed');
  return text;
}

const MATH_FORBID_TAGS = [...FORBID_TAGS.filter((tag) => tag !== 'a' && tag !== 'style'), 'style'];

/**
 * Bereinigung der Ausgabe von KaTeX (HTML mit MathML und kleinen SVG-Teilen). Die Bibliothek ist mit
 * `trust: false` sicher eingestellt, das hier ist eine zweite Schicht: nur HTML, SVG und MathML der
 * Standardlisten, keine Skripte, Stilelemente, Verweise oder Formulare. Die Stilangaben von KaTeX hat
 * `extractInlineStyles` (math-dom.ts) vorher als Text herausgenommen und durch die Marke `data-pgs` ersetzt, die
 * hier erlaubt ist; ein trotzdem übrig gebliebenes `style`-Attribut fällt weg. Der TeX-Quelltext in
 * `annotation` fällt samt Inhalt weg
 * (er stünde sonst als sichtbarer Text im Ergebnis), der MathML-Teil für Screenreader bleibt.
 */
export function sanitizeMathHtml(html: string, win: Window & typeof globalThis = window): string {
  if (html.length > MAX_SVG) throw new RenderError('too_large');
  const purifier = DOMPurify(win);
  return String(
    purifier.sanitize(html, {
      USE_PROFILES: { html: true, svg: true, mathMl: true },
      ADD_TAGS: ['semantics'],
      FORBID_TAGS: MATH_FORBID_TAGS,
      FORBID_ATTR,
      ADD_ATTR: ['data-pgs'],
      FORBID_CONTENTS: ['annotation', 'annotation-xml', 'script', 'style'],
      ALLOW_DATA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      RETURN_TRUSTED_TYPE: false,
    }),
  );
}
