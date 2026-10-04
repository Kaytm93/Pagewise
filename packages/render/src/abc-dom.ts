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
  try {
    abcjs.renderAbc(holder, source, { staffwidth: 680, add_classes: false, responsive: undefined });
    const svg = holder.querySelector('svg');
    if (!svg) throw new RenderError('render_failed');
    return sanitizeSvg(svg.outerHTML);
  } catch (error) {
    throw error instanceof RenderError ? error : new RenderError('render_failed');
  } finally {
    holder.remove();
  }
}
