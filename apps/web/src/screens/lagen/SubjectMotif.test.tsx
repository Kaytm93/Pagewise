// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SUBJECT_ICONS } from '../../ui/SubjectIcon';
import { SubjectMotifs } from '../atelier/SubjectMotifs';
import { SubjectMotif } from './SubjectMotif';

/*
 * Das Fachmotiv im Kopf der Fachseite („Lagen“) zeichnet sich Strich für Strich: Jede Form trägt
 * pathLength="1" und die Klasse lg-motif-stroke (lagen.css setzt dasharray/offset und den Keyframe `draw`).
 * Dieselbe Klasse tragen die gezeichneten Motive von „Atelier“.
 */

describe('SubjectMotif (Lagen)', () => {
  it.each(SUBJECT_ICONS.map((entry) => entry.id))(
    'markiert jede Form von „%s“ zum Zeichnen',
    (id) => {
      const { container } = render(<SubjectMotif icon={id} />);
      const svg = container.querySelector('svg') as SVGSVGElement;
      const shapes = [...svg.querySelectorAll('path, circle, rect, line, polyline, polygon')];

      expect(shapes.length).toBeGreaterThan(0);
      for (const shape of shapes) {
        expect(shape.getAttribute('pathLength'), `${id}: pathLength`).toBe('1');
        expect(shape.classList.contains('lg-motif-stroke'), `${id}: Klasse`).toBe(true);
        expect(shape.getAttribute('style'), `${id}: kein style-Attribut`).toBeNull();
      }
    },
  );

  it('ist hauchdünn, reine Zier und trägt .lg-motif samt eigener Klasse', () => {
    const { container } = render(<SubjectMotif icon="flask" className="top-0 right-0" />);
    const svg = container.querySelector('svg') as SVGSVGElement;

    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('stroke-width')).toBe('0.24');
    expect(svg.classList.contains('lg-motif')).toBe(true);
    expect(svg.classList.contains('top-0')).toBe(true);
    expect(svg.getAttribute('class')).not.toContain('opacity-80');
  });

  it('staffelt die Formen über mo-i-N bis höchstens 6', () => {
    const { container } = render(<SubjectMotif icon="languages" />);
    const staffel = [...container.querySelectorAll('.lg-motif-stroke')].map((shape) =>
      [...shape.classList].find((name) => name.startsWith('mo-i-')),
    );
    expect(staffel[0]).toBe('mo-i-1');
    expect(staffel.every((name) => name && Number(name.slice(5)) <= 6)).toBe(true);
  });

  it('zeigt für unbekannte oder fehlende Kennungen das Buchmotiv', () => {
    const buch = render(<SubjectMotif icon="book" />).container.innerHTML;
    expect(render(<SubjectMotif icon={null} />).container.innerHTML).toBe(buch);
    expect(render(<SubjectMotif icon="gibt-es-nicht" />).container.innerHTML).toBe(buch);
  });
});

describe('SubjectMotifs (Atelier)', () => {
  it('gibt jedem Pfad pathLength="1" und die Klasse lg-motif-stroke, behält aber die Staffelung', () => {
    for (const { id } of SUBJECT_ICONS) {
      const { container } = render(<SubjectMotifs kind={id} />);
      const paths = [...container.querySelectorAll('path')];
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path.getAttribute('pathLength'), `${id}: pathLength`).toBe('1');
        expect(path.classList.contains('lg-motif-stroke'), `${id}: Klasse`).toBe(true);
        expect(path.classList.contains('mo-rise'), `${id}: mo-rise`).toBe(true);
      }
    }
  });
});
