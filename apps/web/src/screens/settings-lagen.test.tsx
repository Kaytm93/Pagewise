// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { ApiClient } from '../api/client';
import { FakeServer } from '../test/fake-server';
import type { Design } from '../ui/design';

/*
 * Einstellungen in der Richtung „Lagen“ (M1-T5): Kicker über der Überschrift, breite Umschalter und
 * die Liste der drei Effektstufen. Die Liste steht in allen Richtungen (WP1b); Kicker und breite
 * Umschalter bleiben „Lagen“ vorbehalten.
 */

function openSettings(design?: Design) {
  if (design) document.documentElement.setAttribute('data-design', design);
  else document.documentElement.removeAttribute('data-design');
  window.history.replaceState(null, '', '/settings');
  return render(<App client={new ApiClient({ fetch: new FakeServer('unlocked').fetch })} />);
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-design');
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-design');
  window.history.replaceState(null, '', '/');
});

describe('Einstellungen in „Lagen“', () => {
  it('zeigt Kicker, breite Umschalter und die Erklärung der Effektstufen', async () => {
    openSettings('lagen');
    await screen.findByRole('heading', { level: 1, name: 'Einstellungen' });

    expect(document.querySelector('.lg-kicker')?.textContent).toBe('Pagewise');

    const group = screen.getByRole('group', { name: 'Bewegung' });
    expect(group.classList.contains('lg-seg-wide')).toBe(true);

    const list = document.querySelector('.lg-fx-list');
    expect(list).not.toBeNull();
    expect(list?.textContent).toContain('Voll.');
    expect(list?.textContent).toContain('Blattwechsel, Federn, gestaffeltes Einblenden.');
    expect(list?.textContent).toContain('Reduziert.');
    expect(list?.textContent).toContain('Nur kurze Überblendungen, keine Wege.');
    expect(list?.textContent).toContain('Aus.');
    expect(list?.textContent).toContain(
      'Keine Bewegung. Zustände zeigen sich als Text und Symbol.',
    );
  });

  it('zeigt in Raum, Atelier und ohne Attribut die Effektstufen-Liste, aber weder Kicker noch breite Umschalter', async () => {
    for (const design of ['raum', 'atelier', undefined] as const) {
      const { unmount } = openSettings(design);
      await screen.findByRole('heading', { level: 1, name: 'Einstellungen' });

      expect(document.querySelector('.lg-kicker'), `${design}: Kicker`).toBeNull();
      const list = document.querySelector('.lg-fx-list');
      expect(list, `${design}: Liste`).not.toBeNull();
      expect(list?.querySelectorAll('li'), `${design}: Einträge`).toHaveLength(3);
      const group = screen.getByRole('group', { name: 'Bewegung' });
      expect(group.classList.contains('lg-seg-wide'), `${design}: Breite`).toBe(false);

      unmount();
    }
  });
});
