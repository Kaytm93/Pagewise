// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { Markdown } from '../Markdown';

beforeAll(async () => {
  // Der Dokument-Block ist ein nachgeladenes Paket; vorab laden, damit der Test nicht an der Wartezeit scheitert.
  await Promise.all([import('./DocumentView'), import('@pagewise/render/document')]);
}, 30_000);

const doc = JSON.stringify({
  title: 'Arbeitsblatt Wasser (erfunden)',
  parts: [
    { type: 'heading', text: 'Aufgabe 1' },
    { type: 'paragraph', text: 'Nenne die Formel von Wasser.' },
    { type: 'list', items: ['Wasserstoff', 'Sauerstoff'] },
  ],
});
const show = (text: string, final = true) => render(<Markdown text={text} final={final} />);

describe('Dokument im Chat', () => {
  it('zeigt die Vorschau mit Titel, Abschnitten und Aufzählung und einen PDF-Knopf', async () => {
    const { container } = show(`\`\`\`document\n${doc}\n\`\`\``);
    await waitFor(() => expect(container.querySelector('article')).not.toBeNull());
    expect(screen.getByRole('article', { name: 'Arbeitsblatt Wasser (erfunden)' })).toBeTruthy();
    expect(screen.getByText('Aufgabe 1')).toBeTruthy();
    expect(container.querySelectorAll('li').length).toBe(2);
    expect(screen.getByRole('button', { name: 'Als PDF herunterladen' })).toBeTruthy();
  });

  it('meldet Zeichen, die die PDF-Schrift nicht kennt, mit festem Text', async () => {
    const bad = JSON.stringify({
      title: 'Formel',
      parts: [{ type: 'paragraph', text: 'H₂O ist Wasser.' }],
    });
    const { container } = show(`\`\`\`document\n${bad}\n\`\`\``);
    await waitFor(() => expect(container.querySelector('[data-block-error]')).not.toBeNull());
    expect(container.querySelector('[data-block-error]')?.getAttribute('data-block-error')).toBe(
      'unsupported_text',
    );
    expect(container.textContent).toContain('Dokument konnte nicht gezeichnet werden.');
  });
});
