import SmilesDrawer from 'smiles-drawer';
import { RenderError } from './errors';
import { sanitizeSvg } from './sanitize';
import { validateSmiles } from './smiles';

const TRANSLATE = /translateX\(\s*(-?[\d.]+)px\s*\)\s*translateY\(\s*(-?[\d.]+)px\s*\)/;

/**
 * SmilesDrawer legt Schriftregeln in ein Stilelement und Verschiebungen in `style`-Attribute. Beides
 * blockiert unsere CSP. Die Verschiebungen werden zu SVG-Attributen (`transform`), das Stilelement fällt weg;
 * die Schrift gibt das Stylesheet der Oberfläche über die Klassen `element` und `sub` vor (`.pg-mol-smiles`).
 */
function withoutInlineStyles(svg: SVGSVGElement): void {
  for (const style of svg.querySelectorAll('style')) style.remove();
  for (const element of svg.querySelectorAll('[style]')) {
    const match = TRANSLATE.exec(element.getAttribute('style') ?? '');
    element.removeAttribute('style');
    if (match) element.setAttribute('transform', `translate(${match[1]} ${match[2]})`);
  }
}

/**
 * Zeichnet eine organische Struktur als Skelettformel (SmilesDrawer, MIT). Braucht eine Seite, weil die
 * Bibliothek Text misst. Das Ergebnis ist bereinigter SVG-Text. Wirft `RenderError`.
 */
export function renderSmiles(smiles: string, width = 320, height = 220): string {
  const invalid = validateSmiles(smiles);
  if (invalid) throw invalid;
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.setProperty('position', 'absolute');
  holder.style.setProperty('left', '-10000px');
  document.body.appendChild(holder);
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    holder.appendChild(svg);
    const drawer = new SmilesDrawer.SvgDrawer({ width, height });
    drawer.draw(SmilesDrawer.Parser.parse(smiles.trim()), svg, 'light');
    svg.classList.add('pg-mol-smiles');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    withoutInlineStyles(svg);
    return sanitizeSvg(new XMLSerializer().serializeToString(svg));
  } catch (error) {
    throw error instanceof RenderError ? error : new RenderError('render_failed');
  } finally {
    holder.remove();
  }
}
