import { type Block, extractBlocks } from './blocks';
import { type DocumentSpec, validateDocument } from './document';
import { type BlockIssue, RenderError } from './errors';
import { validateGraph } from './graph';
import { parseMolSpec, validateFormulaSpec } from './mol';
import { validateQuiz } from './quiz';
import { type SlidesSpec, validateSlides } from './slides';

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
 * Prüft den Quelltext einer Abbildung (Graph, Molekül, Noten) so tief wie das Zeichnen: Die schweren Bibliotheken
 * (SmilesDrawer, abcjs) werden erst geladen, wenn die Art vorkommt. `null`, wenn sich die Abbildung zeichnen lässt.
 */
export async function validateFigureSource(
  kind: 'graph' | 'mol' | 'abc',
  source: string,
): Promise<RenderError | null> {
  if (kind === 'graph') return validateGraph(source);
  if (kind === 'mol') {
    const spec = parseMolSpec(source);
    if (!spec.ok) return spec.error;
    if (spec.value.kind === 'smiles') {
      const { validateSmiles } = await import('./smiles');
      return validateSmiles(spec.value.value);
    }
    return validateFormulaSpec(spec.value);
  }
  const { checkAbc } = await import('./abc');
  return checkAbc(source).error;
}

/** Prüft alle Abbildungen eines Dokuments tief. Der erste Fehler zählt; `null`, wenn alle sich zeichnen lassen. */
export async function validateDocumentFigures(spec: DocumentSpec): Promise<RenderError | null> {
  for (const part of spec.parts) {
    if (part.type !== 'figure') continue;
    const error = await validateFigureSource(part.kind, part.source);
    if (error) return error;
  }
  return null;
}

/** Prüft alle Abbildungen einer Präsentation tief. */
export async function validateSlidesFigures(spec: SlidesSpec): Promise<RenderError | null> {
  for (const slide of spec.slides) {
    if (!slide.figure) continue;
    const error = await validateFigureSource(slide.figure.kind, slide.figure.source);
    if (error) return error;
  }
  return null;
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
      case 'quiz':
        error = validateQuiz(block.source);
        break;
      case 'document':
        error = validateDocument(block.source);
        break;
      case 'slides':
        error = validateSlides(block.source);
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
