import katex from 'katex';
import { LIMITS, RenderError } from './errors';

/**
 * Formeln mit KaTeX. Die Einstellungen sind für fremden Text gewählt: kein `trust` (keine Links, keine
 * Stilangaben von außen), Grenzen für Makro-Ausdehnung und Größe, Fehler als Ausnahme statt rot gefärbtem
 * Text. `strict: 'ignore'`, damit unbekannte Zeichen keine Konsolenwarnungen erzeugen.
 */
function options(display: boolean, onUntrusted: () => void): katex.KatexOptions {
  return {
    throwOnError: true,
    displayMode: display,
    output: 'htmlAndMathml',
    strict: 'ignore',
    // Verweise, Bilder und eigene Klassen oder Stile bleiben aus. KaTeX schreibt den Befehl dann rot in die
    // Formel, statt zu scheitern; hier wird das als Fehler gemeldet, damit es ein Modell korrigieren kann.
    trust: () => {
      onUntrusted();
      return false;
    },
    maxSize: 20,
    maxExpand: 500,
  };
}

/** Wirft `RenderError` (`empty`, `too_large`, `invalid_math`). */
export function katexHtml(latex: string, display: boolean): string {
  if (latex.trim() === '') throw new RenderError('empty');
  if (latex.length > LIMITS.math) throw new RenderError('too_large');
  let untrusted = false;
  try {
    const html = katex.renderToString(
      latex,
      options(display, () => {
        untrusted = true;
      }),
    );
    if (untrusted) throw new RenderError('invalid_math');
    return html;
  } catch (error) {
    if (error instanceof RenderError) throw error;
    const position =
      error instanceof Error && 'position' in error && typeof error.position === 'number'
        ? String(error.position)
        : undefined;
    throw new RenderError('invalid_math', position);
  }
}

/** `null`, wenn die Formel gezeichnet werden kann, sonst der Fehler. Ohne DOM nutzbar (Server, Tests). */
export function validateMath(latex: string, display: boolean): RenderError | null {
  try {
    katexHtml(latex, display);
    return null;
  } catch (error) {
    return error instanceof RenderError ? error : new RenderError('invalid_math');
  }
}
