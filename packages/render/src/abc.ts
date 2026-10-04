import abcjs from 'abcjs';
import { LIMITS, RenderError } from './errors';

export interface AbcCheck {
  error: RenderError | null;
  /** Hinweise, die den Block nicht unbrauchbar machen (zum Beispiel ungenaue Taktlängen). */
  warning: boolean;
}

/** Position („Zeile:Spalte“) aus einer abcjs-Meldung, ohne deren Text zu übernehmen (er enthält die Eingabe). */
function position(message: string): string | undefined {
  const match = /Line:(\d+):(\d+)/.exec(message);
  return match ? `${match[1]}:${match[2]}` : undefined;
}

/**
 * Prüft einen ` ```abc `-Block ohne DOM. Fehler: leer, zu groß, kein Notensystem oder unbekannte Zeichen
 * (das ist, was ein Modell mit Fließtext statt Noten liefert). Alles andere, was abcjs bemängelt, ist nur ein
 * Hinweis und löst keine Korrekturanfrage aus.
 */
export function checkAbc(source: string): AbcCheck {
  if (source.trim() === '') return { error: new RenderError('empty'), warning: false };
  if (source.length > LIMITS.abc) return { error: new RenderError('too_large'), warning: false };
  let tunes: ReturnType<typeof abcjs.parseOnly>;
  try {
    tunes = abcjs.parseOnly(source);
  } catch {
    return { error: new RenderError('invalid_abc'), warning: false };
  }
  const tune = tunes[0];
  if (!tune?.lines.some((line) => 'staff' in line && line.staff)) {
    return { error: new RenderError('invalid_abc'), warning: false };
  }
  const warnings = tune.warnings ?? [];
  const fatal = warnings.find((message) =>
    /unknown character|unexpected|unrecognized/i.test(message),
  );
  if (fatal) return { error: new RenderError('invalid_abc', position(fatal)), warning: false };
  return { error: null, warning: warnings.length > 0 };
}

export function validateAbc(source: string): RenderError | null {
  return checkAbc(source).error;
}
