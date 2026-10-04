import { type BlockIssue, RenderError } from '../errors';
import { compileExpression } from './expression';
import { renderGraphSvg } from './plot';
import { parseGraphSpec } from './spec';

export { compileExpression } from './expression';
export { niceTicks, renderGraphSvg } from './plot';
export { type GraphSpec, parseGraphSpec } from './spec';

/** Zeichnet den Inhalt eines ` ```graph `-Blocks. Wirft `RenderError`. */
export function renderGraph(source: string): string {
  const spec = parseGraphSpec(source);
  if (!spec.ok) throw spec.error;
  return renderGraphSvg(spec.value);
}

/** Prüft einen ` ```graph `-Block, ohne zu zeichnen. `null`, wenn er in Ordnung ist. */
export function validateGraph(source: string): RenderError | null {
  const spec = parseGraphSpec(source);
  if (!spec.ok) return spec.error;
  try {
    for (const entry of spec.value.functions) compileExpression(entry.expr);
    return null;
  } catch (error) {
    return error instanceof RenderError ? error : new RenderError('render_failed');
  }
}

export type { BlockIssue };
