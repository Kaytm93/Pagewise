import { describe, expect, it } from 'vitest';
import { extractBlocks } from './blocks';
import { LIMITS } from './errors';
import { parseQuizSpec, validateQuiz } from './quiz';
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
