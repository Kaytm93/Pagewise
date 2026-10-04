import abcjs from 'abcjs';
import { checkAbc } from './abc';
import { RenderError } from './errors';
import { sanitizeSvg } from './sanitize';

/**
 * Zeichnet Noten als bereinigten SVG-Text. Braucht eine Seite (abcjs misst Text im SVG): gezeichnet wird in
 * ein vorübergehendes, unsichtbares Element am Dokument und danach entfernt. Ohne Wiedergabe. Wirft
 * `RenderError`.
 */
export function renderAbc(source: string): string {
  const check = checkAbc(source);
  if (check.error) throw check.error;
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.setProperty('position', 'absolute');
  holder.style.setProperty('left', '-10000px');
  holder.style.setProperty('width', '720px');
  document.body.appendChild(holder);
  // abcjs fügt jedem Bild ein Stilelement ein (nur gegen Textauswahl beim Ziehen). Unsere CSP blockiert es mit einer
  // Meldung in der Konsole; es bliebe ohne Wirkung. Für die Dauer des Zeichnens wird daraus ein leeres
  // Gruppenelement. Das Zeichnen läuft synchron, danach ist `createElementNS` wieder das Original.
  const create = document.createElementNS.bind(document);
  document.createElementNS = ((
    namespace: string | null,
    name: string,
    options?: ElementCreationOptions,
  ) =>
    create(namespace, name === 'style' ? 'g' : name, options)) as typeof document.createElementNS;
  try {
    abcjs.renderAbc(holder, source, { staffwidth: 680, add_classes: false, responsive: undefined });
    const svg = holder.querySelector('svg');
    if (!svg) throw new RenderError('render_failed');
    return sanitizeSvg(svg.outerHTML);
  } catch (error) {
    throw error instanceof RenderError ? error : new RenderError('render_failed');
  } finally {
    // Der eigene Eintrag am Dokument verschwindet, damit wieder die Funktion des Prototyps gilt.
    Reflect.deleteProperty(document, 'createElementNS');
    holder.remove();
  }
}
