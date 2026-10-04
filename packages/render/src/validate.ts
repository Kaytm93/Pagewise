import { checkAbc } from './abc';
import { type Block, extractBlocks } from './blocks';
import { type BlockIssue, RenderError } from './errors';
import { validateGraph } from './graph';
import { validateMath } from './math';
import { parseMolSpec, validateFormulaSpec } from './mol';
import { validateSmiles } from './smiles';

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
 */
export function validateMarkdown(markdown: string): BlockIssue[] {
  const issues: BlockIssue[] = [];
  for (const block of extractBlocks(markdown)) {
    let error: RenderError | null = null;
    const severity: BlockIssue['severity'] = 'error';
    switch (block.kind) {
      case 'math':
        error = validateMath(block.source, block.display);
        break;
      case 'graph':
        error = validateGraph(block.source);
        break;
      case 'mol': {
        const spec = parseMolSpec(block.source);
        if (!spec.ok) error = spec.error;
        else
          error =
            spec.value.kind === 'smiles'
              ? validateSmiles(spec.value.value)
              : validateFormulaSpec(spec.value);
        break;
      }
      case 'abc': {
        const check = checkAbc(block.source);
        error = check.error;
        if (!error && check.warning) {
          issues.push(issue(block, new RenderError('invalid_abc'), 'warning'));
        }
        break;
      }
    }
    if (error) issues.push(issue(block, error, severity));
  }
  return issues;
}
