import { format, messages as m } from '../../i18n';

/**
 * Die automatische Korrekturanfrage zu einer Antwort mit fehlerhaften Blöcken, oder `null`, wenn alles zu
 * zeichnen ist. Sie nennt je Block nur Art, Nummer, einen festen deutschen Text und den Fehlercode (nie Text
 * aus dem Block oder einer Bibliothek) und beginnt mit einem festen Anfang, an dem die Oberfläche erkennt, dass
 * es schon eine Korrektur war: Es gibt höchstens eine pro Antwort.
 */
export async function autoFixRequest(content: string): Promise<string | null> {
  const { validateMarkdown } = await import('@pagewise/render/validate');
  const issues = (await validateMarkdown(content)).filter((issue) => issue.severity === 'error');
  if (issues.length === 0) return null;
  const errors = m.blocks.errors as Record<string, string>;
  const lines = issues.slice(0, 8).map((issue) =>
    format(m.chat.autoFix.item, {
      kind: m.blocks[issue.kind],
      n: String(issue.index),
      text: errors[issue.code] ?? m.blocks.errors.render_failed,
      code: issue.code,
      detail: issue.detail ? `: ${issue.detail}` : '',
    }),
  );
  return [m.chat.autoFix.intro, ...lines, m.chat.autoFix.outro].join('\n');
}

/** Sieht der Text nach einem Block aus? Spart das Laden der Prüfung bei gewöhnlichen Antworten. */
export const mayContainBlocks = (content: string): boolean =>
  /```(?:graph|mol|abc)|\$/i.test(content);
