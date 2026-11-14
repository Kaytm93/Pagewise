// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './copyText';
import { useCopy } from './useCopy';

/*
 * „Kopieren“ einer Antwort mit Quiz, wenn die Umschreibung nicht nachgeladen werden kann (ohne Netz, Teilpaket
 * fehlt; D-123): Dann heißt es „Kopieren nicht möglich“, und in die Zwischenablage kommt nichts, nie
 * ersatzweise der Text mit der Lösung.
 */

vi.mock('@pagewise/render/quiz', () => {
  throw new Error('Teilpaket nicht erreichbar (erfunden)');
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

const content = `Übung:\n\n\`\`\`quiz\n${JSON.stringify({
  questions: [{ question: 'Welche Formel hat Wasser?', options: ['CO2', 'H2O'], answer: 1 }],
})}\n\`\`\``;

describe('Kopieren, wenn die Quiz-Umschreibung nicht lädt (D-123)', () => {
  it('meldet „nicht möglich“ und schreibt nichts in die Zwischenablage', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { result } = renderHook(() => useCopy());
    await act(async () => {
      await result.current.copy(copyText(content));
    });
    expect(result.current.copyState).toBe('failed');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('kopiert eine Antwort ohne Quiz trotzdem', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { result } = renderHook(() => useCopy());
    await act(async () => {
      await result.current.copy(copyText('Nur Text, "answer": 1.'));
    });
    expect(writeText).toHaveBeenCalledWith('Nur Text, "answer": 1.');
    expect(result.current.copyState).toBe('copied');
  });
});
