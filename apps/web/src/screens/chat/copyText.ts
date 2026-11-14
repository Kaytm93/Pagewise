/**
 * Text einer Antwort für „Kopieren“ (D-123): Enthält sie ein Quiz, steht in der Zwischenablage statt der
 * Antwortnummer `answer` der Prüfwert `key`, wie im Hefteintrag. Die Umschreibung (`@pagewise/render/quiz`)
 * wird nachgeladen, damit das Hauptpaket klein bleibt; im Chat liegt sie meist schon bereit, weil die
 * Quiz-Anzeige dasselbe Paket lädt.
 */

type Hide = (markdown: string) => string;

/** Öffnender Zaun eines Quiz-Blocks, wie ihn `hideQuizAnswers` erkennt. */
const QUIZ_FENCE = /^ {0,3}(?:`{3,}|~{3,})\s*quiz(?![^\s`])/im;

let hide: Hide | null = null;
let loading: Promise<Hide> | null = null;

export const hasQuiz = (text: string): boolean => QUIZ_FENCE.test(text);

function load(): Promise<Hide> {
  loading ??= import('@pagewise/render/quiz').then((module) => {
    hide = module.hideQuizAnswers;
    return hide;
  });
  return loading;
}

/** Lädt die Umschreibung vorab, damit der Klick auf „Kopieren“ ohne Wartezeit kopiert. */
export function preloadQuizHiding(): void {
  void load().catch(() => {
    loading = null;
  });
}

/**
 * Text für die Zwischenablage. Ohne Quiz oder mit schon geladener Umschreibung kommt er sofort (synchron),
 * damit Safari das Schreiben in die Zwischenablage noch dem Klick zurechnet; sonst als Promise nach dem Laden.
 */
export function copyText(text: string): string | Promise<string> {
  if (!hasQuiz(text)) return text;
  if (hide) return hide(text);
  return load().then((loaded) => loaded(text));
}
