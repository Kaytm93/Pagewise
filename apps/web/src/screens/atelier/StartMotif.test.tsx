// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StartMotif } from './StartMotif';

/*
 * Das Zierbild der Startseite in „Atelier“: rein dekorativ (für Hilfsmittel unsichtbar, nicht fokussierbar, ohne
 * Beschriftung); jeder Strich trägt `pathLength="1"` und die Klasse `lg-motif-stroke`, damit ihn der Keyframe
 * `draw` zeichnen kann (atelier-fach.css).
 */

describe('StartMotif', () => {
  it('ist dekorativ: aria-hidden, nicht fokussierbar, ohne Beschriftung', () => {
    const { container } = render(<StartMotif />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.getAttribute('role')).toBeNull();
    expect(svg?.getAttribute('aria-label')).toBeNull();
    expect(svg?.querySelector('title, desc, text')).toBeNull();
    expect(svg?.hasAttribute('style')).toBe(false);
  });

  it('gibt jedem Strich pathLength und die Zeichenklasse, gestaffelt über mo-i-N', () => {
    const { container } = render(<StartMotif />);
    const paths = [...container.querySelectorAll('path')];
    expect(paths.length).toBeGreaterThan(0);
    paths.forEach((path, index) => {
      expect(path.getAttribute('pathLength')).toBe('1');
      expect(path.classList.contains('lg-motif-stroke')).toBe(true);
      expect(path.classList.contains(`mo-i-${index + 1}`)).toBe(true);
      expect(path.getAttribute('d')).toMatch(/^M/);
      expect(path.hasAttribute('style')).toBe(false);
    });
    // Nur Striche, keine Füllflächen oder anderen Formen.
    expect(container.querySelectorAll('svg > *')).toHaveLength(paths.length);
  });
});
