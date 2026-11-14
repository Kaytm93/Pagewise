import { describe, expect, it } from 'vitest';
import { extractBlocks } from './blocks';
import { LIMITS } from './errors';
import { hideQuizAnswers, parseQuizSpec, quizKey, validateQuiz } from './quiz';
import { validateMarkdown } from './validate';

const question = (overrides: Record<string, unknown> = {}) => ({
  question: 'Welche Formel hat Wasser?',
  options: ['CO2', 'H2O', 'NH3'],
  answer: 1,
  ...overrides,
});
const quiz = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ questions: [question()], ...overrides });

describe('Quiz-Angabe', () => {
  it('liest Fragen mit Titel und Erklärung', () => {
    const result = parseQuizSpec(
      quiz({
        title: 'Moleküle',
        questions: [question({ explanation: 'Zwei Wasserstoffatome, ein Sauerstoffatom.' })],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        title: 'Moleküle',
        questions: [
          {
            question: 'Welche Formel hat Wasser?',
            options: ['CO2', 'H2O', 'NH3'],
            answer: 1,
            explanation: 'Zwei Wasserstoffatome, ein Sauerstoffatom.',
          },
        ],
      },
    });
  });

  it('macht Titel und Erklärung optional', () => {
    const result = parseQuizSpec(quiz());
    expect(result.ok && result.value.title).toBeUndefined();
    expect(result.ok && result.value.questions[0]?.explanation).toBeUndefined();
  });

  it.each([
    ['', 'empty', undefined],
    ['{', 'invalid_json', undefined],
    ['[]', 'invalid_quiz', undefined],
    [quiz({ extra: 1 }), 'invalid_quiz', undefined],
    [quiz({ questions: [] }), 'invalid_quiz', 'questions'],
    [quiz({ questions: 'eine Frage' }), 'invalid_quiz', 'questions'],
    [quiz({ title: '   ' }), 'invalid_quiz', 'title'],
    [quiz({ questions: [question({ question: '' })] }), 'invalid_quiz', 'question'],
    [quiz({ questions: [question({ options: ['H2O'] })] }), 'invalid_quiz', 'options'],
    [
      quiz({ questions: [question({ options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })] }),
      'invalid_quiz',
      'options',
    ],
    [quiz({ questions: [question({ options: ['H2O', 'H2O '] })] }), 'invalid_quiz', 'options'],
    [quiz({ questions: [question({ options: ['H2O', 3] })] }), 'invalid_quiz', 'options'],
    [quiz({ questions: [question({ answer: 3 })] }), 'invalid_quiz', 'answer'],
    [quiz({ questions: [question({ answer: -1 })] }), 'invalid_quiz', 'answer'],
    [quiz({ questions: [question({ answer: 0.5 })] }), 'invalid_quiz', 'answer'],
    [quiz({ questions: [question({ answer: '1' })] }), 'invalid_quiz', 'answer'],
    [quiz({ questions: [question({ explanation: '' })] }), 'invalid_quiz', 'explanation'],
    [quiz({ questions: [question({ hint: 'x' })] }), 'invalid_quiz', 'questions'],
    [
      quiz({ questions: Array.from({ length: 11 }, () => question()) }),
      'invalid_quiz',
      'questions',
    ],
    [quiz({ questions: [question({ question: 'Frage\u0001' })] }), 'invalid_quiz', 'question'],
  ])('lehnt %j ab (%s, Hinweis %s)', (source, code, detail) => {
    const result = parseQuizSpec(source);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.detail).toBe(detail);
    }
  });

  it('begrenzt die Größe', () => {
    const big = quiz({ title: 'x'.repeat(LIMITS.quiz) });
    expect(parseQuizSpec(big)).toMatchObject({ ok: false, error: { code: 'too_large' } });
  });

  it('nennt im Hinweis nie Text aus der Eingabe', () => {
    const result = parseQuizSpec(quiz({ questions: [question({ answer: 'geheimnis' })] }));
    expect(JSON.stringify(result)).not.toMatch(/geheimnis/);
  });

  it('prüft ohne Befund, wenn alles in Ordnung ist', () => {
    expect(validateQuiz(quiz())).toBeNull();
    expect(validateQuiz('{}')?.code).toBe('invalid_quiz');
  });
});

describe('Quiz im Text', () => {
  it('erkennt den Block als eigene Art', () => {
    const blocks = extractBlocks(`Text\n\n\`\`\`quiz\n${quiz()}\n\`\`\`\n`);
    expect(blocks).toEqual([expect.objectContaining({ kind: 'quiz', index: 1, source: quiz() })]);
  });

  it('meldet einen fehlerhaften Quiz-Block mit Art und Nummer', async () => {
    const issues = await validateMarkdown(
      `\`\`\`quiz\n${quiz()}\n\`\`\`\n\n\`\`\`quiz\n{"questions":[]}\n\`\`\``,
    );
    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'quiz',
        index: 2,
        code: 'invalid_quiz',
        detail: 'questions',
      }),
    ]);
  });

  it('lässt gültige Quizze ohne Befund', async () => {
    expect(await validateMarkdown(`\`\`\`quiz\n${quiz()}\n\`\`\``)).toEqual([]);
  });
});

/** Die Antwortnummern eines Blocks, wie die Anzeige sie liest. */
const answersOf = (source: string) => {
  const result = parseQuizSpec(source);
  return result.ok ? result.value.questions.map((item) => item.answer) : result.error;
};
const fence = (source: string) => `\`\`\`quiz\n${source}\n\`\`\``;
/** Inhalt des ersten Quiz-Blocks eines Texts. */
const firstQuiz = (markdown: string) =>
  extractBlocks(markdown).find((block) => block.kind === 'quiz')?.source ?? '';

describe('Prüfwert statt Antwortnummer (D-123)', () => {
  const two = quiz({
    title: 'Moleküle',
    questions: [
      question({ explanation: 'Zwei Wasserstoffatome.' }),
      question({ question: 'Welche Formel hat Ammoniak?', options: ['NH3', 'CH4'], answer: 0 }),
    ],
  });

  it('rechnet einen festen, kurzen Prüfwert über Frage und Antwort', () => {
    expect(quizKey('Welche Formel hat Wasser?', 'H2O')).toMatch(/^[0-9a-f]{8}$/);
    expect(quizKey('Welche Formel hat Wasser?', 'H2O')).toBe(
      quizKey('Welche Formel hat Wasser?', 'H2O'),
    );
    // Frage und Antwort sind getrennt: dieselben Zeichen anders verteilt ergeben einen anderen Wert.
    expect(quizKey('ab', 'c')).not.toBe(quizKey('a', 'bc'));
    // Unicode zählt als UTF-8, nicht nur das untere Byte
    expect(quizKey('Wärme?', 'Ä')).not.toBe(quizKey('Wärme?', 'Å'));
    expect(quizKey('Was ist π?', '≈ 3,14 🥧')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('schreibt hin und zurück dieselben Lösungen, ohne "answer" im Text', () => {
    const markdown = `# Übung\n\nVorher.\n\n${fence(two)}\n\nNachher.`;
    const hidden = hideQuizAnswers(markdown);
    expect(hidden).not.toContain('"answer"');
    expect(hidden).toContain('"key"');
    expect(hidden.startsWith('# Übung\n\nVorher.\n\n```quiz\n')).toBe(true);
    expect(hidden.endsWith('\n```\n\nNachher.')).toBe(true);
    expect(answersOf(firstQuiz(hidden))).toEqual([1, 0]);
    // Titel, Erklärung und Reihenfolge der Antworten bleiben
    expect(parseQuizSpec(firstQuiz(hidden))).toEqual(parseQuizSpec(two));
    // Zweimal umschreiben ändert nichts mehr
    expect(hideQuizAnswers(hidden)).toBe(hidden);
  });

  it('behält die Schreibweise: einzeilig bleibt einzeilig, mehrzeilig wird eingerückt', () => {
    expect(firstQuiz(hideQuizAnswers(fence(two))).includes('\n')).toBe(false);
    const pretty = JSON.stringify(JSON.parse(two), null, 2);
    const hidden = firstQuiz(hideQuizAnswers(fence(pretty)));
    expect(hidden.split('\n').length).toBeGreaterThan(5);
    expect(answersOf(hidden)).toEqual([1, 0]);
  });

  it('findet die richtige Antwort auch, wenn die Antworten umgestellt werden', () => {
    const key = quizKey('Welche Formel hat Wasser?', 'H2O');
    const moved = quiz({
      questions: [{ question: 'Welche Formel hat Wasser?', options: ['H2O', 'NH3', 'CO2'], key }],
    });
    expect(answersOf(moved)).toEqual([0]);
  });

  it('liest alte Blöcke mit "answer" weiter', () => {
    expect(answersOf(two)).toEqual([1, 0]);
  });

  it.each([
    [
      'umformulierte Antwort',
      quiz({
        questions: [
          {
            question: 'Welche Formel hat Wasser?',
            options: ['CO2', 'H₂O', 'NH3'],
            key: quizKey('Welche Formel hat Wasser?', 'H2O'),
          },
        ],
      }),
      'key',
    ],
    [
      'umformulierte Frage',
      quiz({
        questions: [
          {
            question: 'Welche Formel hat Wasser? ',
            options: ['CO2', 'H2O', 'NH3'],
            key: quizKey('Welche Formel hat Wasser?', 'H2O'),
          },
        ],
      }),
      'key',
    ],
    [
      'Nummer und Prüfwert zugleich',
      quiz({ questions: [question({ key: quizKey('Welche Formel hat Wasser?', 'H2O') })] }),
      'answer',
    ],
    [
      'Prüfwert als Zahl',
      quiz({ questions: [{ ...question(), answer: undefined, key: 12345678 }] }),
      'key',
    ],
    [
      'Prüfwert in Großbuchstaben',
      quiz({ questions: [{ ...question(), answer: undefined, key: 'ABCDEF12' }] }),
      'key',
    ],
    [
      'Prüfwert zu kurz',
      quiz({ questions: [{ ...question(), answer: undefined, key: 'abc' }] }),
      'key',
    ],
    [
      'weder Nummer noch Prüfwert',
      quiz({ questions: [{ ...question(), answer: undefined }] }),
      'answer',
    ],
  ])('lehnt ab: %s', (_name, source, detail) => {
    const result = parseQuizSpec(source);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_quiz');
      expect(result.error.detail).toBe(detail);
    }
  });

  it('lehnt zwei Antworten mit gleichem Prüfwert ab und lässt solche Blöcke beim Umschreiben stehen', () => {
    // Echter Zusammenstoß von FNV-1a (32 Bit), für diese Frage gesucht
    const asked = 'Welche Zahl ist gemeint?';
    expect(quizKey(asked, 'Antwort 875009')).toBe(quizKey(asked, 'Antwort 1190714'));
    const options = ['Antwort 875009', 'Antwort 1190714', 'Antwort 3'];
    const clash = quiz({ questions: [{ question: asked, options, answer: 1 }] });
    expect(hideQuizAnswers(fence(clash))).toBe(fence(clash));
    const keyed = quiz({
      questions: [{ question: asked, options, key: quizKey(asked, options[1] as string) }],
    });
    expect(parseQuizSpec(keyed)).toMatchObject({ ok: false, error: { detail: 'key' } });
    // Die dritte Antwort hat einen eigenen Wert: als Lösung ist sie eindeutig
    const fine = quiz({ questions: [{ question: asked, options, answer: 2 }] });
    expect(answersOf(firstQuiz(hideQuizAnswers(fence(fine))))).toEqual([2]);
  });

  it('lässt ungültige, offene und fremde Blöcke Zeichen für Zeichen stehen', () => {
    const broken = '```quiz\n{"questions":[{"question":"A?","options":["x","y"],"answer":5}]}\n```';
    expect(hideQuizAnswers(broken)).toBe(broken);
    const open = `Text\n\n\`\`\`quiz\n${two}`;
    expect(hideQuizAnswers(open)).toBe(open);
    const notQuiz = `\`\`\`json\n${two}\n\`\`\`\n\n\`\`\`graph\n{"answer":1}\n\`\`\``;
    expect(hideQuizAnswers(notQuiz)).toBe(notQuiz);
    // Ein Quiz als Beispiel in einem längeren Codeblock ist Code, kein Quiz
    const example = `\`\`\`\`markdown\n${fence(two)}\n\`\`\`\`\n\nText mit "answer": 1 und quiz.`;
    expect(hideQuizAnswers(example)).toBe(example);
    const plain = 'Kein Block, nur "answer": 2 im Text über ein Quiz.';
    expect(hideQuizAnswers(plain)).toBe(plain);
  });

  it('schreibt jeden Quiz-Block eines Texts um und lässt alles dazwischen stehen', () => {
    const other = quiz({ questions: [question({ answer: 2 })] });
    const markdown = `${fence(two)}\r\n\n\`\`\`json\n{"answer":1}\n\`\`\`\n\n~~~quiz\n${other}\n~~~\n\n  \`\`\`quiz\n  ${other}\n  \`\`\`\n`;
    const hidden = hideQuizAnswers(markdown);
    const quizzes = extractBlocks(hidden).filter((block) => block.kind === 'quiz');
    expect(quizzes.map((block) => answersOf(block.source))).toEqual([[1, 0], [2], [2]]);
    expect(quizzes.every((block) => !block.source.includes('"answer"'))).toBe(true);
    expect(hidden).toContain('```json\n{"answer":1}\n```');
    expect(hidden).toContain('\n  ```quiz\n  {"questions"');
    expect(hidden.endsWith('\n  ```\n')).toBe(true);
  });

  it('lässt einen Block stehen, der umgeschrieben über die Grenze käme', () => {
    // Zehn Fragen werden je um sechs Zeichen länger ("answer":0 → "key":"…"); aufgefüllt bis kurz unter die Grenze
    const build = (pad: number) =>
      quiz({
        questions: Array.from({ length: 10 }, (_, q) =>
          question({
            question: `Frage ${q}?`,
            options: Array.from({ length: 6 }, (_, o) => `${'Antwort '.repeat(15)}${o}`),
            explanation: q === 0 ? 'y'.repeat(pad) : undefined,
            answer: 0,
          }),
        ),
      });
    let pad = 1;
    while (build(pad + 1).length <= LIMITS.quiz - 10) pad += 1;
    const near = build(pad);
    expect(near.length).toBeLessThanOrEqual(LIMITS.quiz);
    expect(near.length + 10 * 5).toBeGreaterThan(LIMITS.quiz);
    expect(parseQuizSpec(near).ok).toBe(true);
    expect(hideQuizAnswers(fence(near))).toBe(fence(near));
  });

  it('prüft umgeschriebene Blöcke ohne Befund', async () => {
    expect(await validateMarkdown(hideQuizAnswers(fence(two)))).toEqual([]);
  });
});
