import { fail, hasControlChars, LIMITS, ok, type RenderError, type Result } from './errors';

/**
 * Eine Frage: zwei bis sechs Antworten, genau eine ist richtig (`answer` ist ihr Index, ab 0). Im Block steht
 * dafür `answer` (so schreibt die KI) oder `key`, ein Prüfwert der richtigen Antwort (D-123); gelesen ergibt
 * beides denselben Index.
 */
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

const encoder = new TextEncoder();
const KEY = /^[0-9a-f]{8}$/;

/**
 * Prüfwert einer Antwort (D-123): FNV-1a (32 Bit) über die UTF-8-Bytes von Frage und Antwort, getrennt durch
 * ein Nullzeichen (das in keinem der beiden Texte stehen darf), als acht Kleinbuchstaben-Hexziffern. Synchron
 * und ohne WebCrypto, damit Anzeige und Server ihn gleich rechnen. Er macht die Lösung nur nicht auf einen Blick
 * lesbar; wer will, rechnet ihn für jede Antwort nach. Ein Geheimnis ist er nicht.
 */
export function quizKey(question: string, option: string): string {
  let hash = 0x811c9dc5;
  for (const byte of encoder.encode(`${question}\u0000${option}`)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Index der Antworten, deren Prüfwert zu `key` passt. */
const optionsWithKey = (question: string, options: string[], key: string) =>
  options.flatMap((option, index) => (quizKey(question, option) === key ? [index] : []));

function readQuestion(entry: unknown): Result<QuizQuestion> {
  if (
    !isObject(entry) ||
    !hasOnly(entry, ['question', 'options', 'answer', 'key', 'explanation'])
  ) {
    return fail('invalid_quiz', 'questions');
  }
  const { question, options, answer, key, explanation } = entry;
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

  let right: number;
  if (key !== undefined) {
    // Entweder die Nummer oder der Prüfwert, nie beides: sonst könnten sie einander widersprechen.
    if (answer !== undefined) return fail('invalid_quiz', 'answer');
    if (typeof key !== 'string' || !KEY.test(key)) return fail('invalid_quiz', 'key');
    // Genau eine Antwort muss passen. Keine heißt: Frage oder Antwort wurden umformuliert. Zwei hieße ein
    // Zusammenstoß der Prüfwerte; so einen Block schreibt `hideQuizAnswers` nie.
    const matches = optionsWithKey(question, choices, key);
    if (matches.length !== 1) return fail('invalid_quiz', 'key');
    right = matches[0] as number;
  } else if (
    typeof answer !== 'number' ||
    !Number.isInteger(answer) ||
    answer < 0 ||
    answer >= choices.length
  ) {
    return fail('invalid_quiz', 'answer');
  } else {
    right = answer;
  }

  let note: string | undefined;
  if (explanation !== undefined) {
    if (!isText(explanation, MAX.explanation)) return fail('invalid_quiz', 'explanation');
    note = explanation;
  }
  return ok({ question, options: choices, answer: right, explanation: note });
}

/**
 * Liest den Inhalt eines ` ```quiz `-Blocks (JSON): `questions` mit einer bis zehn Fragen, je Frage `question`,
 * `options` (zwei bis sechs verschiedene Antworten), `answer` (Index der richtigen Antwort, ab 0) oder `key`
 * (Prüfwert der richtigen Antwort, siehe {@link quizKey}) und optional `explanation`. Dazu optional `title`. Unbekannte Felder werden abgelehnt. Von Hand geprüft wie beim Graphen,
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

/** Öffnender Zaun wie in `blocks.ts` (`extractBlocks`), dazu die Einrückung, die der neue Inhalt behält. */
const OPEN = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)/;

/**
 * Schreibt im Inhalt eines gültigen Quiz-Blocks jede Antwortnummer `answer` in ihren Prüfwert `key` um (D-123).
 * `null` heißt: unverändert lassen, weil der Block ungültig ist, ein Prüfwert nicht eindeutig wäre, der neue
 * Block über die Grenze von 8.192 Zeichen käme oder er gelesen nicht dieselben Lösungen ergäbe.
 */
function hideInSource(source: string): string | null {
  const before = parseQuizSpec(source);
  if (!before.ok) return null;
  const json = JSON.parse(source) as { questions: Json[] };
  const questions: Json[] = [];
  for (const [q, entry] of json.questions.entries()) {
    const item = before.value.questions[q] as QuizQuestion;
    if (entry.answer === undefined) {
      questions.push(entry);
      continue;
    }
    const key = quizKey(item.question, item.options[item.answer] as string);
    if (optionsWithKey(item.question, item.options, key).length !== 1) return null;
    // Die Reihenfolge der Felder bleibt, nur `answer` wird an seiner Stelle zu `key`.
    questions.push(
      Object.fromEntries(
        Object.entries(entry).map(([name, value]) =>
          name === 'answer' ? ['key', key] : [name, value],
        ),
      ),
    );
  }
  const hidden = JSON.stringify(
    { ...json, questions },
    null,
    source.includes('\n') ? 2 : undefined,
  );
  if (hidden.length > LIMITS.quiz) return null;
  const after = parseQuizSpec(hidden);
  if (!after.ok) return null;
  const same = after.value.questions.every(
    (item, q) => item.answer === before.value.questions[q]?.answer,
  );
  return same ? hidden : null;
}

/**
 * Verbirgt die Lösungen aller ` ```quiz `-Blöcke eines Markdown-Texts (D-123): In jedem gültigen Block wird
 * `answer` zum Prüfwert `key`. Alles andere bleibt Zeichen für Zeichen, auch ungültige oder nicht geschlossene
 * Quiz-Blöcke und Quiz-Text in anderen Codeblöcken (etwa in einem ` ````markdown `-Block als Beispiel). Die
 * Zäune erkennt dieselbe Regel wie `extractBlocks`. Für den Hefteintrag aus dem Chat und für „Kopieren“.
 */
export function hideQuizAnswers(markdown: string): string {
  if (!/quiz/i.test(markdown)) return markdown;
  const lines = markdown.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    out.push(line);
    i += 1;
    const open = OPEN.exec(line);
    if (!open) continue;
    const indent = open[1] as string;
    const marker = open[2] as string;
    const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
    const body: string[] = [];
    let end: string | null = null;
    while (i < lines.length) {
      const current = lines[i] as string;
      i += 1;
      if (close.test(current)) {
        end = current;
        break;
      }
      body.push(current);
    }
    const hidden =
      end !== null && (open[3] as string).toLowerCase() === 'quiz'
        ? hideInSource(body.join('\n'))
        : null;
    if (hidden === null) out.push(...body);
    else out.push(...hidden.split('\n').map((part) => indent + part));
    if (end !== null) out.push(end);
  }
  return out.join('\n');
}
