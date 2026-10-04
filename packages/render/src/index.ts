/**
 * Gemeinsamer Kern für Hefteinträge. Dieser Einstieg enthält nur Leichtes (Typen, Blöcke finden, Fehlercodes);
 * die schweren Teile haben eigene Einstiege, damit die Oberfläche sie nachladen kann:
 * `@pagewise/render/math` (KaTeX), `/graph`, `/mol`, `/abc` (abcjs), `/smiles` (SmilesDrawer), `/sanitize`
 * (DOMPurify) und `/validate` (alles ohne DOM, für den Server).
 */
export { type Block, extractBlocks, type FenceBlock, type MathBlock } from './blocks';
export {
  type BlockIssue,
  type BlockKind,
  fail,
  hasControlChars,
  LIMITS,
  ok,
  RenderError,
  type RenderErrorCode,
  type Result,
} from './errors';
