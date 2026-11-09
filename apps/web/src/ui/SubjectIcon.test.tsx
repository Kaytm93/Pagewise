// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { messages as m } from '../i18n';
import { SUBJECT_ICONS, SUBJECT_MOTIFS, SubjectIcon } from './SubjectIcon';

/*
 * D-110: Die Fach-Motive sind eigene Zeichnungen (kein lucide-react mehr). Sie teilen ein Raster (24 × 24, Rand
 * mindestens 1,5), eine Rundung (runde Enden und Ecken) und die Strichstärke 1,6; die Fachseite zeichnet sie mit
 * 0,4. Ein Fach ohne bekannte Kennung zeigt das neutrale Motiv, nicht das Buch.
 */

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const kennungen = Object.keys(m.subjectDialog.iconNames);

/** Anzahl der Zahlen je Pfadbefehl; nur absolute Befehle sind erlaubt. */
const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, A: 7, Z: 0 };

/** Alle x- und y-Werte eines Pfads, Stützpunkte eingeschlossen (beim Bogen nur der Endpunkt). */
function punkte(d: string): { x: number[]; y: number[] } {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
  const x: number[] = [];
  const y: number[] = [];
  let index = 0;
  while (index < tokens.length) {
    const befehl = tokens[index++] as string;
    const anzahl = ARITY[befehl];
    if (anzahl === undefined) throw new Error(`Befehl „${befehl}“ ist nicht erlaubt: ${d}`);
    const werte = tokens.slice(index, index + anzahl).map(Number);
    index += anzahl;
    if (befehl === 'H') x.push(werte[0] as number);
    else if (befehl === 'V') y.push(werte[0] as number);
    else if (befehl === 'A') {
      x.push(werte[5] as number);
      y.push(werte[6] as number);
    } else {
      for (let k = 0; k < anzahl; k += 2) {
        x.push(werte[k] as number);
        y.push(werte[k + 1] as number);
      }
    }
  }
  return { x, y };
}

/** Äußerste Werte einer Form im Raster. */
function ausdehnung(shape: string | readonly number[]): number[] {
  if (typeof shape === 'string') {
    const { x, y } = punkte(shape);
    return [...x, ...y];
  }
  if (shape.length === 3) {
    const [cx, cy, r] = shape as [number, number, number];
    return [cx - r, cx + r, cy - r, cy + r];
  }
  const [x, y, width, height] = shape as [number, number, number, number, number];
  return [x, x + width, y, y + height];
}

describe('Fach-Motive: eigene Zeichnungen (D-110)', () => {
  it('gibt es für jede der 15 Kennungen aus de.ts und dazu das neutrale Motiv', () => {
    expect(kennungen).toHaveLength(15);
    expect(Object.keys(SUBJECT_MOTIFS).sort()).toEqual([...kennungen, 'neutral'].sort());
    expect(SUBJECT_ICONS.map((entry) => entry.id)).toEqual(kennungen);
  });

  it('kommt ohne lucide-react aus, auch im großen Motiv der Richtung „Lagen“', () => {
    for (const file of ['ui/SubjectIcon.tsx', 'screens/lagen/SubjectMotif.tsx']) {
      expect(readFileSync(join(src, file), 'utf8'), file).not.toContain('lucide-react');
    }
  });

  it.each(Object.keys(SUBJECT_MOTIFS))('„%s“ teilt Raster, Rundung und Strichstärke', (id) => {
    const { container } = render(<SubjectIcon icon={id === 'neutral' ? null : id} />);
    const svg = container.querySelector('svg') as SVGSVGElement;

    expect(svg.getAttribute('data-icon')).toBe(id);
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('1.6');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('class')).not.toContain('lucide');
    // Keine eigene Farbe und keine Füllung an den Formen: Die Fachfarbe kommt nur über currentColor.
    for (const shape of svg.querySelectorAll('*')) {
      expect(shape.getAttribute('fill'), id).toBeNull();
      expect(shape.getAttribute('stroke'), id).toBeNull();
      expect(shape.getAttribute('style'), id).toBeNull();
    }
  });

  it.each(Object.entries(SUBJECT_MOTIFS))(
    '„%s“ bleibt im Raster (1,5 bis 22,5) und hat höchstens fünf Formen',
    (id, shapes) => {
      expect(shapes.length, id).toBeGreaterThan(0);
      expect(shapes.length, id).toBeLessThanOrEqual(5);
      for (const shape of shapes) {
        for (const wert of ausdehnung(shape)) {
          expect(wert, `${id}: ${String(shape)}`).toBeGreaterThanOrEqual(1.5);
          expect(wert, `${id}: ${String(shape)}`).toBeLessThanOrEqual(22.5);
        }
      }
    },
  );

  it('zeichnet jedes Motiv anders', () => {
    const zeichnungen = Object.values(SUBJECT_MOTIFS).map((shapes) => JSON.stringify(shapes));
    expect(new Set(zeichnungen).size).toBe(zeichnungen.length);
  });

  it('schließt das Buch am Rücken: beide Seiten enden oben und unten im selben Punkt', () => {
    const [links, rechts, ruecken] = SUBJECT_MOTIFS.book;
    for (const seite of [links, rechts]) {
      expect(seite.startsWith('M12 6.5 ')).toBe(true);
      expect(seite.endsWith(' 12 20')).toBe(true);
    }
    expect(ruecken).toBe('M12 6.5 V20');
  });

  it('reicht die Strichstärke der Fachseite (0,4) durch', () => {
    const { container } = render(<SubjectIcon icon="calculator" strokeWidth={0.4} className="x" />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('stroke-width')).toBe('0.4');
    expect(svg.getAttribute('class')).toBe('x');
  });
});

describe('Fach ohne Kennung (D-110)', () => {
  const html = (icon: string | null) => render(<SubjectIcon icon={icon} />).container.innerHTML;

  it('zeigt das neutrale Motiv, nicht das Buch', () => {
    expect(html(null)).toContain('data-icon="neutral"');
    expect(html('gibt-es-nicht')).toBe(html(null));
    expect(html(null)).not.toBe(html('book'));
  });

  it('gibt Mathe ein eigenes Motiv aus Rechenzeichen', () => {
    expect(m.subjectDialog.iconNames.calculator).toBe('Rechenzeichen');
    expect(html('calculator')).toContain('data-icon="calculator"');
    expect(html('calculator')).not.toBe(html('book'));
  });
});
