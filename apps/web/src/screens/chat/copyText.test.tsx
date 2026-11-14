// @vitest-environment jsdom
import { parseQuizSpec } from '@pagewise/render/quiz';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../api/types';
import { copyText } from './copyText';
import { MessageItem } from './MessageItem';

/*
 * „Kopieren“ an einer Antwort mit Quiz (M10-T009, D-123): In der Zwischenablage steht statt der Antwortnummer
 * `answer` der Prüfwert `key`, wie im Hefteintrag. Die Antwort im Chat selbst bleibt unverändert.
 */

beforeAll(async () => {
  // Nachgeladene Pakete vorab laden, damit der Test nicht an der Wartezeit scheitert.
  await Promise.all([import('@pagewise/render/quiz'), import('./blocks/QuizView')]);
}, 30_000);

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

const quiz = JSON.stringify({
  questions: [
    { question: 'Welche Formel hat Wasser?', options: ['CO2', 'H2O', 'NH3'], answer: 1 },
    { question: 'Welche Formel hat Ammoniak?', options: ['NH3', 'CH4'], answer: 0 },
  ],
});
const content = `Kleine Übung:\n\n\`\`\`quiz\n${quiz}\n\`\`\`\n\nViel Erfolg!`;

function message(text: string): ChatMessage {
  return {
    id: 'n2',
    seq: 2,
    role: 'assistant',
    content: text,
    status: 'complete',
    providerId: null,
    model: null,
    engineProfileId: null,
    errorCode: null,
    activity: [],
    assets: [],
    artifacts: [],
    codeRuns: [],
    reasoning: null,
    tokensPerSecond: null,
    costUsd: null,
    createdAt: 0,
  };
}

function clipboard() {
  const writeText = vi.fn((_text: string) => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

const show = (text: string) =>
  render(
    <MessageItem
      message={message(text)}
      live={false}
      thinking={false}
      canRetry={false}
      onRetry={() => {}}
    />,
  );

describe('Kopieren einer Antwort mit Quiz (D-123)', () => {
  it('kopiert den Prüfwert statt der Antwortnummer, gleich im Klick', async () => {
    const writeText = clipboard();
    show(content);
    // Die Umschreibung liegt bereit, sobald die Antwort mit Quiz fertig dasteht.
    await waitFor(() => expect(typeof copyText(content)).toBe('string'));
    fireEvent.click(screen.getByRole('button', { name: 'Antwort kopieren' }));
    // Ohne Warten: Safari rechnet das Schreiben in die Zwischenablage nur dem Klick selbst zu.
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]?.[0] ?? '';
    expect(copied).not.toContain('"answer"');
    expect(copied).toContain('"key"');
    expect(copied.startsWith('Kleine Übung:\n\n```quiz\n')).toBe(true);
    expect(copied.endsWith('\n```\n\nViel Erfolg!')).toBe(true);
    const source = /```quiz\n([\s\S]*?)\n```/.exec(copied)?.[1] ?? '';
    const read = parseQuizSpec(source);
    expect(read.ok && read.value.questions.map((item) => item.answer)).toEqual([1, 0]);
    // Die Antwort im Chat zeigt weiter das Quiz, nicht den Quelltext
    expect(await screen.findByRole('button', { name: 'Prüfen' })).toBeTruthy();
  });

  it('kopiert eine Antwort ohne Quiz Zeichen für Zeichen', async () => {
    const writeText = clipboard();
    const plain = 'Im Text steht "answer": 1, aber kein Quiz.\n\n```json\n{"answer":1}\n```';
    show(plain);
    fireEvent.click(screen.getByRole('button', { name: 'Antwort kopieren' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(plain));
  });

  it('erkennt den Quiz-Zaun wie die Umschreibung', async () => {
    expect(await copyText('```quizzes\n{"answer":1}\n```')).toBe('```quizzes\n{"answer":1}\n```');
    expect(await copyText(`~~~quiz\n${quiz}\n~~~`)).not.toContain('"answer"');
  });
});
