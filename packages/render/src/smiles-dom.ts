import SmilesDrawer from 'smiles-drawer';
import { RenderError } from './errors';
import { sanitizeSvg } from './sanitize';
import { validateSmiles } from './smiles';

const TRANSLATE = /translateX\(\s*(-?[\d.]+)px\s*\)\s*translateY\(\s*(-?[\d.]+)px\s*\)/;

/**
 * Während `run` läuft, werden `style`-Angaben über `setAttribute` und `setAttributeNS` nicht gesetzt: Die einzige
 * Angabe, die SmilesDrawer so schreibt (eine Verschiebung `translateX(…) translateY(…)`), wird zu einem
 * SVG-Attribut `transform`. Das Zeichnen läuft synchron, danach gelten wieder die Funktionen des Prototyps.
 * Ohne das meldet der Browser für jedes Bild einen Verstoß gegen die CSP, obwohl die Angabe nie wirken durfte.
 */
function withoutStyleAttributes<T>(run: () => T): T {
  const proto = Element.prototype;
  const plain = proto.setAttribute;
  const namespaced = proto.setAttributeNS;
  const translate = (element: Element, value: string) => {
    const match = TRANSLATE.exec(value);
    if (match) plain.call(element, 'transform', `translate(${match[1]} ${match[2]})`);
  };
  proto.setAttribute = function (name: string, value: string) {
    if (name === 'style') return translate(this, String(value));
    return plain.call(this, name, value);
  };
  proto.setAttributeNS = function (namespace: string | null, name: string, value: string) {
    if (name === 'style') return translate(this, String(value));
    return namespaced.call(this, namespace, name, value);
  };
  try {
    return run();
  } finally {
    proto.setAttribute = plain;
    proto.setAttributeNS = namespaced;
  }
}

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
 * SmilesDrawer lässt die Zeichenfläche so groß, wie angefragt, auch wenn das Molekül klein ist. Hier wird der
 * Ausschnitt auf den Inhalt zugeschnitten (mit Rand) und die Größe so gesetzt, dass Schrift und Bindungen gut
 * lesbar sind. Messen geht nur im Dokument; das Element hat dann keine Stilangaben mehr (siehe oben), der
 * kurze Aufenthalt im Dokument löst also keine CSP-Meldung aus.
 */
function fitToContent(svg: SVGSVGElement): void {
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.setProperty('position', 'absolute');
  holder.style.setProperty('left', '-10000px');
  holder.style.setProperty('visibility', 'hidden');
  document.body.appendChild(holder);
  try {
    holder.appendChild(svg);
    const box = svg.getBBox();
    const pad = 12;
    const scale = 1.35;
    svg.setAttribute(
      'viewBox',
      `${box.x - pad} ${box.y - pad} ${box.width + 2 * pad} ${box.height + 2 * pad}`,
    );
    svg.setAttribute('width', String(Math.round((box.width + 2 * pad) * scale)));
    svg.setAttribute('height', String(Math.round((box.height + 2 * pad) * scale)));
  } finally {
    svg.remove();
    holder.remove();
  }
}

/**
 * Zeichnet eine organische Struktur als Skelettformel (SmilesDrawer, MIT). Braucht eine Seite, weil die
 * Bibliothek Text misst. Das Ergebnis ist bereinigter SVG-Text. Wirft `RenderError`.
 */
export function renderSmiles(smiles: string, width = 320, height = 220): string {
  const invalid = validateSmiles(smiles);
  if (invalid) throw invalid;
  try {
    // Gezeichnet wird in einem Element außerhalb des Dokuments: SmilesDrawer misst Text über ein Canvas, nicht
    // über das Layout, und ein Stilelement im Dokument würde die CSP mit einer Meldung blockieren.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const drawer = new SmilesDrawer.SvgDrawer({ width, height });
    const tree = SmilesDrawer.Parser.parse(smiles.trim());
    withoutStyleAttributes(() => drawer.draw(tree, svg, 'light'));
    svg.classList.add('pg-mol-smiles');
    withoutInlineStyles(svg);
    fitToContent(svg);
    return sanitizeSvg(new XMLSerializer().serializeToString(svg));
  } catch (error) {
    throw error instanceof RenderError ? error : new RenderError('render_failed');
  }
}
