// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { Markdown } from '../Markdown';

beforeAll(async () => {
  // Der Folien-Block ist ein nachgeladenes Paket; vorab laden, damit der Test nicht an der Wartezeit scheitert.
  await Promise.all([import('./SlidesView'), import('@pagewise/render/slides')]);
}, 30_000);

const deck = JSON.stringify({
  title: 'Wasser (erfunden)',
  slides: [
    { title: 'Stoffe', bullets: ['H2O', 'Sauerstoff'], text: 'Erfundene Beispielfolie.' },
    { title: 'Ende' },
  ],
});

describe('Präsentation im Chat', () => {
  it('zeigt je Folie eine Karte mit Titel, Stichpunkten und Absatz und den Knopf', async () => {
    const { container } = render(<Markdown text={`\`\`\`slides\n${deck}\n\`\`\``} final />);
    await waitFor(() => expect(container.querySelectorAll('section[aria-label]').length).toBe(2));
    expect(screen.getByRole('region', { name: 'Folie 1 von 2' })).toBeTruthy();
    expect(container.querySelectorAll('li').length).toBe(4);
    expect(screen.getByRole('button', { name: 'Als PowerPoint herunterladen' })).toBeTruthy();
  });

  it('meldet einen fehlerhaften Aufbau mit festem Text', async () => {
    const { container } = render(
      <Markdown text={'```slides\n{"title":"x","slides":[]}\n```'} final />,
    );
    await waitFor(() => expect(container.querySelector('[data-block-error]')).not.toBeNull());
    expect(container.querySelector('[data-block-error]')?.getAttribute('data-block-error')).toBe(
      'invalid_slides',
    );
    expect(container.textContent).toContain('Präsentation konnte nicht gezeichnet werden.');
  });
});
