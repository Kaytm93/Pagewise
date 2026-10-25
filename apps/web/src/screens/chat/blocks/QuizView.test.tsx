// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import { Markdown } from '../Markdown';

beforeAll(async () => {
  // Der Quiz-Block ist ein nachgeladenes Paket; vorab laden, damit der Test nicht an der Wartezeit scheitert.
  await Promise.all([import('./QuizView'), import('@pagewise/render/quiz')]);
}, 30_000);

const quiz = JSON.stringify({
  title: 'Moleküle',
  questions: [
    {
      question: 'Welche Formel hat Wasser?',
      options: ['CO2', 'H2O', 'NH3'],
      answer: 1,
      explanation: 'Zwei Wasserstoffatome und ein Sauerstoffatom.',
    },
    { question: 'Welche Formel hat Ammoniak?', options: ['NH3', 'CH4'], answer: 0 },
  ],
});
const show = (text: string, final = true) => render(<Markdown text={text} final={final} />);

describe('Quiz im Chat', () => {
  it('zeigt Fragen und Antworten, Prüfen bleibt bis zur ersten Wahl gesperrt', async () => {
    const { container } = show(`\`\`\`quiz\n${quiz}\n\`\`\``);
    await waitFor(() => expect(container.querySelector('section.pg-quiz')).not.toBeNull());
    expect(screen.getByText('Welche Formel hat Wasser?')).toBeTruthy();
    expect(container.querySelectorAll('input[type="radio"]').length).toBe(5);
    expect(screen.getByRole('button', { name: 'Prüfen' }).hasAttribute('disabled')).toBe(true);
  });

  it('wertet lokal aus: richtig, falsch und Erklärung', async () => {
    const user = userEvent.setup();
    show(`\`\`\`quiz\n${quiz}\n\`\`\``);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prüfen' })).toBeTruthy());

    await user.click(screen.getByRole('radio', { name: /H2O/ }));
    await user.click(screen.getByRole('radio', { name: /CH4/ }));
    await user.click(screen.getByRole('button', { name: 'Prüfen' }));

    expect(screen.getByRole('status').textContent).toBe('1 von 2 richtig');
    // Erste Frage richtig: Markierung an der Antwort und Rückmeldung darunter
    expect(screen.getAllByText('Richtig').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Falsch Richtige Antwort: NH3')).toBeTruthy();
    expect(
      screen.getByText('Erklärung: Zwei Wasserstoffatome und ein Sauerstoffatom.'),
    ).toBeTruthy();
    // Nach dem Prüfen ist nichts mehr wählbar
    expect(screen.getByRole('radio', { name: /H2O/ }).hasAttribute('disabled')).toBe(true);
  });

  it('beginnt mit „Noch einmal“ von vorn', async () => {
    const user = userEvent.setup();
    show(`\`\`\`quiz\n${quiz}\n\`\`\``);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prüfen' })).toBeTruthy());
    await user.click(screen.getByRole('radio', { name: /H2O/ }));
    await user.click(screen.getByRole('button', { name: 'Prüfen' }));
    await user.click(screen.getByRole('button', { name: 'Noch einmal' }));
    expect(screen.getByRole('button', { name: 'Prüfen' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('radio', { name: /H2O/ }).hasAttribute('disabled')).toBe(false);
  });

  it('zeigt bei einem fehlerhaften Aufbau eine feste Meldung und den Quelltext', async () => {
    const { container } = show('```quiz\n{"questions":[]}\n```');
    await waitFor(() => expect(container.querySelector('[data-block-error]')).not.toBeNull());
    expect(container.querySelector('[data-block-error]')?.getAttribute('data-block-error')).toBe(
      'invalid_quiz',
    );
    expect(container.textContent).toContain('Quiz konnte nicht gezeichnet werden.');
    expect(container.querySelector('pre')?.textContent).toContain('"questions":[]');
  });

  it('zeigt während des Schreibens keine Fehlermeldung', async () => {
    const { container } = show('```quiz\n{"questions":', false);
    await waitFor(() => expect(container.querySelector('pre')).not.toBeNull());
    expect(container.querySelector('[data-block-error]')).toBeNull();
  });
});
