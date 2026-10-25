import { fail, hasControlChars, LIMITS, ok, type RenderError, type Result } from './errors';

/** Eine Frage: zwei bis sechs Antworten, genau eine ist richtig (`answer` ist ihr Index, ab 0). */
export interface QuizQuestion {
  question: string;
  options: string[];
  answer: number;
  explanation: string | undefined;
}

export interface QuizSpec {
  title: string | undefined;
  questions: QuizQuestion[];
}

/** Obergrenzen je Feld: ein Quiz bleibt überschaubar und die Anzeige im Chat lesbar. */
const MAX = {
  questions: 10,
  options: 6,
  title: 120,
  question: 300,
  option: 160,
  explanation: 400,
} as const;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Text, nicht leer, nicht zu lang, ohne Steuerzeichen. Die Oberfläche zeigt ihn nur als Text, nie als Markup. */
const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.trim() !== '' &&
  value.length <= max &&
  !hasControlChars(value);

/** Nur diese Schlüssel sind erlaubt; alles andere lehnt die Prüfung ab. */
const hasOnly = (value: Json, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

function readQuestion(entry: unknown): Result<QuizQuestion> {
  if (!isObject(entry) || !hasOnly(entry, ['question', 'options', 'answer', 'explanation'])) {
    return fail('invalid_quiz', 'questions');
  }
  const { question, options, answer, explanation } = entry;
  if (!isText(question, MAX.question)) return fail('invalid_quiz', 'question');

  if (!Array.isArray(options) || options.length < 2 || options.length > MAX.options) {
    return fail('invalid_quiz', 'options');
  }
  const choices: string[] = [];
  for (const option of options) {
    if (!isText(option, MAX.option)) return fail('invalid_quiz', 'options');
    choices.push(option);
  }
  // Gleiche Antworten machen die Auswertung mehrdeutig.
  if (new Set(choices.map((choice) => choice.trim())).size !== choices.length) {
    return fail('invalid_quiz', 'options');
  }

  if (
    typeof answer !== 'number' ||
    !Number.isInteger(answer) ||
    answer < 0 ||
    answer >= choices.length
  ) {
    return fail('invalid_quiz', 'answer');
  }

  let note: string | undefined;
  if (explanation !== undefined) {
    if (!isText(explanation, MAX.explanation)) return fail('invalid_quiz', 'explanation');
    note = explanation;
  }
  return ok({ question, options: choices, answer, explanation: note });
}

/**
 * Liest den Inhalt eines ` ```quiz `-Blocks (JSON): `questions` mit einer bis zehn Fragen, je Frage `question`,
 * `options` (zwei bis sechs verschiedene Antworten), `answer` (Index der richtigen Antwort, ab 0) und optional
 * `explanation`. Dazu optional `title`. Unbekannte Felder werden abgelehnt. Von Hand geprüft wie beim Graphen,
 * ohne Schema-Bibliothek (siehe `graph/spec.ts`).
 *
 * Fehler tragen als Hinweis nur den Namen des Feldes, nie Text aus der Eingabe.
 */
export function parseQuizSpec(source: string): Result<QuizSpec> {
  if (source.trim() === '') return fail('empty');
  if (source.length > LIMITS.quiz) return fail('too_large');
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return fail('invalid_json');
  }
  if (!isObject(json) || !hasOnly(json, ['title', 'questions'])) return fail('invalid_quiz');

  let title: string | undefined;
  if (json.title !== undefined) {
    if (!isText(json.title, MAX.title)) return fail('invalid_quiz', 'title');
    title = json.title;
  }

  const entries = json.questions;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX.questions) {
    return fail('invalid_quiz', 'questions');
  }
  const questions: QuizQuestion[] = [];
  for (const entry of entries) {
    const question = readQuestion(entry);
    if (!question.ok) return question;
    questions.push(question.value);
  }
  return ok({ title, questions });
}

/** Prüft einen ` ```quiz `-Block, ohne ihn anzuzeigen. `null`, wenn er in Ordnung ist. */
export function validateQuiz(source: string): RenderError | null {
  const spec = parseQuizSpec(source);
  return spec.ok ? null : spec.error;
}
