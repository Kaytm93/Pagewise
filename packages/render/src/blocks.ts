import type { BlockKind } from './errors';

export interface FenceBlock {
  kind: Extract<BlockKind, 'graph' | 'mol' | 'abc'>;
  source: string;
  /** Nummer dieses Blocks unter den Blöcken derselben Art, ab 1. */
  index: number;
}

export interface MathBlock {
  kind: 'math';
  source: string;
  display: boolean;
  index: number;
}

export type Block = FenceBlock | MathBlock;

const FENCE_LANGS = new Set(['graph', 'mol', 'abc']);
const OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;

/**
 * Findet die Blöcke eines Markdown-Texts, so wie die Darstellung sie erkennt: umzäunte Blöcke der Sprachen
 * `graph`, `mol` und `abc` sowie Formeln (`$$…$$` als Anzeige, `$…$` im Text). Inhalt anderer umzäunter
 * Blöcke und Code im Text bleibt unberücksichtigt, dort steht ein Dollarzeichen nur als Zeichen.
 *
 * Das ist eine Prüfhilfe für den Server (ohne die Markdown-Bibliothek der Oberfläche) und bewusst etwas
 * vorsichtiger als diese: Im Zweifel gilt etwas als Text, nie als Block.
 */
export function extractBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const counts: Record<BlockKind, number> = { math: 0, graph: 0, mol: 0, abc: 0 };
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const prose: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    const open = OPEN.exec(line);
    if (!open) {
      prose.push(line);
      i += 1;
      continue;
    }
    const marker = open[1] as string;
    const lang = (open[2] as string).toLowerCase();
    const body: string[] = [];
    i += 1;
    while (i < lines.length) {
      const current = lines[i] as string;
      const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
      if (close.test(current)) {
        i += 1;
        break;
      }
      body.push(current);
      i += 1;
    }
    prose.push('');
    if (FENCE_LANGS.has(lang)) {
      const kind = lang as FenceBlock['kind'];
      counts[kind] += 1;
      blocks.push({ kind, source: body.join('\n'), index: counts[kind] });
    }
  }

  const text = prose.join('\n');
  for (const match of mathSegments(text)) {
    counts.math += 1;
    blocks.push({ kind: 'math', ...match, index: counts.math });
  }
  return blocks;
}

/** Entfernt Code im Text (` `x` `), damit darin kein Dollarzeichen als Formel gilt. */
function withoutInlineCode(text: string): string {
  return text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (all) => ' '.repeat(all.length));
}

function mathSegments(text: string): { source: string; display: boolean }[] {
  const clean = withoutInlineCode(text);
  const found: { source: string; display: boolean }[] = [];
  let pos = 0;
  while (pos < clean.length) {
    const start = clean.indexOf('$', pos);
    if (start === -1) break;
    if (clean[start - 1] === '\\') {
      pos = start + 1;
      continue;
    }
    if (clean[start + 1] === '$') {
      const end = clean.indexOf('$$', start + 2);
      if (end === -1) break;
      found.push({ source: clean.slice(start + 2, end).trim(), display: true });
      pos = end + 2;
      continue;
    }
    // Im Text: kein Leerzeichen nach dem öffnenden und vor dem schließenden Zeichen, nicht über eine Leerzeile
    let end = start + 1;
    let closed = false;
    while (end < clean.length) {
      const next = clean.indexOf('$', end);
      if (next === -1) break;
      if (clean[next - 1] === '\\') {
        end = next + 1;
        continue;
      }
      closed = true;
      end = next;
      break;
    }
    if (!closed) break;
    const inner = clean.slice(start + 1, end);
    const valid = inner.length > 0 && !/^\s|\s$/.test(inner) && !/\n\s*\n/.test(inner);
    if (valid) {
      found.push({ source: inner, display: false });
      pos = end + 1;
    } else {
      pos = start + 1;
    }
  }
  return found;
}
