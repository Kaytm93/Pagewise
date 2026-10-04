/** Die Arten von Blöcken, die ein Hefteintrag außer Text enthalten kann. */
export type BlockKind = 'math' | 'graph' | 'mol' | 'abc';

/**
 * Fehlercodes beim Prüfen und Zeichnen. Es sind nur feste Codes, nie Text aus dem Block oder aus einer
 * Bibliothek: Der Fehlertext kann Eingaben des Modells enthalten (und damit Anweisungen oder Markup), und er
 * wird einmal an das Modell zurückgegeben (Retry). Genaueres steht, wenn überhaupt, in `detail` (nur Zahlen
 * und Feldnamen, die dieses Paket selbst erzeugt).
 */
export type RenderErrorCode =
  | 'empty'
  | 'too_large'
  | 'invalid_math'
  | 'invalid_json'
  | 'invalid_spec'
  | 'invalid_expression'
  | 'too_complex'
  | 'unknown_formula'
  | 'invalid_smiles'
  | 'invalid_abc'
  | 'render_failed';

export class RenderError extends Error {
  readonly code: RenderErrorCode;
  readonly detail: string | undefined;

  constructor(code: RenderErrorCode, detail?: string) {
    super(code);
    this.name = 'RenderError';
    this.code = code;
    this.detail = detail;
  }
}

/** Ein Befund beim Prüfen eines Texts: welcher Block (Art und Nummer ab 1) und was daran nicht stimmt. */
export interface BlockIssue {
  kind: BlockKind;
  /** Nummer des Blocks dieser Art im Text, ab 1. */
  index: number;
  code: RenderErrorCode;
  detail?: string;
  /** `error` löst bei Bedarf eine Korrekturanfrage aus, `warning` nicht. */
  severity: 'error' | 'warning';
}

/** Ergebnis ohne Ausnahme: entweder ein Wert oder ein Fehler. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: RenderError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (code: RenderErrorCode, detail?: string): Result<never> => ({
  ok: false,
  error: new RenderError(code, detail),
});

/** Grenzen für Eingaben (Zeichen), damit ein Block nie unbegrenzt Rechenzeit oder Speicher braucht. */
export const LIMITS = {
  math: 2_000,
  graph: 8_192,
  mol: 1_024,
  abc: 8_192,
  expression: 200,
} as const;

/** Steuerzeichen (außer Zeilenumbruch und Tabulator) in einer Eingabe: werden abgelehnt. */
export function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if ((code < 32 && code !== 10 && code !== 9 && code !== 13) || code === 127) return true;
  }
  return false;
}
