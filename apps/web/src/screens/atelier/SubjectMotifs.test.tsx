// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { ApiClient } from '../../api/client';
import { FakeServer } from '../../test/fake-server';

/*
 * Die Fachmotive der Richtung „Atelier“ (D-045): Nur dort zeichnet `SubjectMotifs` die gestaffelte
 * Linien-Gruppe; „Lagen“, „Raum“ und die Richtung ohne Attribut behalten das bisherige Symbol.
 * Die Motive sind rein dekorativ und darum für Hilfsmittel unsichtbar.
 */

function setup() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach Atelier', { icon: 'flask', color: 0 });
  return { server, subject };
}

function mount(server: FakeServer, path: string, design?: 'raum' | 'lagen' | 'atelier') {
  if (design) document.documentElement.setAttribute('data-design', design);
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-design');
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  document.documentElement.removeAttribute('data-design');
});

describe('Fachmotive in „Atelier“', () => {
  it('zeichnet die gestaffelte Motivgruppe als dekoratives SVG', async () => {
    const { server, subject } = setup();
    mount(server, `/subjects/${subject.id}`, 'atelier');
    await screen.findByRole('heading', { level: 1, name: 'Beispielfach Atelier' });

    const svg = document.querySelector('[data-motif]');
    expect(svg?.tagName.toLowerCase()).toBe('svg');
    expect(svg?.getAttribute('data-motif')).toBe('flask');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');

    // Drei Motive, jedes mit eigener Staffelklasse (mo-i-1 … mo-i-3) aus motion.css.
    const motive = [...(svg?.querySelectorAll('.mo-rise') ?? [])];
    expect(motive).toHaveLength(3);
    motive.forEach((motiv, index) => {
      expect(motiv.classList.contains(`mo-i-${index + 1}`)).toBe(true);
    });

    // Keine Inline-Styles: Farbe und Strichstärke kommen aus den Tokens.
    expect(svg?.querySelector('[style]')).toBeNull();
    expect(svg?.getAttribute('style')).toBeNull();
  });
});

describe.each([
  ['Lagen', 'lagen'],
  ['Raum', 'raum'],
  ['ohne Richtung', undefined],
] as const)('%s', (_name, design) => {
  it('behält das bisherige Fachsymbol statt der Motive', async () => {
    const { server, subject } = setup();
    mount(server, `/subjects/${subject.id}`, design);
    await screen.findByRole('heading', { level: 1, name: 'Beispielfach Atelier' });

    expect(document.querySelector('[data-motif]')).toBeNull();
    // Das bisherige Symbol bleibt an seinem Platz (in „Lagen“ im eigenen Kopf, sonst oben rechts).
    expect(document.querySelector('.lg-motif')).toBeTruthy();
  });
});
