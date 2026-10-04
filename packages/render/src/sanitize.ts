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
