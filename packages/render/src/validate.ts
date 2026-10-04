import { type Block, extractBlocks } from './blocks';
import { type BlockIssue, RenderError } from './errors';
import { validateGraph } from './graph';
import { parseMolSpec, validateFormulaSpec } from './mol';

function issue(
  block: Block,
  error: RenderError,
  severity: BlockIssue['severity'] = 'error',
): BlockIssue {
  return {
    kind: block.kind,
    index: block.index,
    code: error.code,
    ...(error.detail !== undefined && { detail: error.detail }),
    severity,
  };
}

/**
 * Prüft alle Blöcke eines Hefteintrags oder einer Antwort (Formeln, Graph, Molekül, Noten) ohne DOM, also auch
 * auf dem Server. Gibt die Befunde zurück; leer heißt: alles lässt sich zeichnen. Die Befunde enthalten nur
 * feste Codes (siehe `RenderErrorCode`), nie Text aus den Blöcken.
 *
 * Die schweren Bibliotheken (KaTeX, abcjs, SmilesDrawer) werden erst geladen, wenn ein Block der Art vorkommt.
 */
export async function validateMarkdown(markdown: string): Promise<BlockIssue[]> {
  const issues: BlockIssue[] = [];
  for (const block of extractBlocks(markdown)) {
    let error: RenderError | null = null;
    switch (block.kind) {
      case 'math': {
        const { validateMath } = await import('./math');
        error = validateMath(block.source, block.display);
        break;
      }
      case 'graph':
        error = validateGraph(block.source);
        break;
      case 'mol': {
        const spec = parseMolSpec(block.source);
        if (!spec.ok) {
          error = spec.error;
        } else if (spec.value.kind === 'smiles') {
          const { validateSmiles } = await import('./smiles');
          error = validateSmiles(spec.value.value);
        } else {
          error = validateFormulaSpec(spec.value);
        }
        break;
      }
      case 'abc': {
        const { checkAbc } = await import('./abc');
        const check = checkAbc(block.source);
        error = check.error;
        if (!error && check.warning) {
          issues.push(issue(block, new RenderError('invalid_abc'), 'warning'));
        }
        break;
      }
    }
    if (error) issues.push(issue(block, error));
  }
  return issues;
}
