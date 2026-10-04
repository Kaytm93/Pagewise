import type { RenderError } from '@pagewise/render';

export type SvgBlockKind = 'graph' | 'mol' | 'abc';

const cache = new Map<string, string>();
const CACHE_LIMIT = 120;

/** Merkt sich Ergebnisse: Beim Streamen wird derselbe Block bei jedem neuen Textstück erneut angefragt. */
function remember(key: string, svg: string): string {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, svg);
  return svg;
}

async function draw(kind: SvgBlockKind, source: string): Promise<string> {
  if (kind === 'graph') {
    const { renderGraph } = await import('@pagewise/render/graph');
    return renderGraph(source);
  }
  if (kind === 'abc') {
    const { renderAbc } = await import('@pagewise/render/abc-dom');
    return renderAbc(source);
  }
  const { parseMolSpec, renderFormula } = await import('@pagewise/render/mol');
  const spec = parseMolSpec(source);
  if (!spec.ok) throw spec.error;
  if (spec.value.kind === 'smiles') {
    const { renderSmiles } = await import('@pagewise/render/smiles-dom');
    return renderSmiles(spec.value.value);
  }
  return renderFormula(spec.value);
}

/**
 * Zeichnet einen Block (Graph, Molekül, Noten) zu bereinigtem SVG-Text. Alles geht durch dieselbe
 * Bereinigung (`sanitizeSvg`), auch die eigenen Zeichnungen. Die Bibliotheken werden erst geladen, wenn ein
 * Block der Art vorkommt. Wirft `RenderError` mit einem festen Code.
 */
export async function renderBlock(kind: SvgBlockKind, source: string): Promise<string> {
  const key = `${kind}\u0000${source}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const { sanitizeSvg } = await import('@pagewise/render/sanitize');
  const { RenderError: Failure } = await import('@pagewise/render');
  try {
    return remember(key, sanitizeSvg(await draw(kind, source)));
  } catch (error) {
    throw error instanceof Failure ? error : new Failure('render_failed');
  }
}

export type { RenderError };
