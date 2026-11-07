// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { de } from '../i18n/de';
import { ColorPicker } from './ColorPicker';

/*
 * B-16 (D-097): Die Farbwahl hat acht Punkte zu je 44 px. In einer Zeile mit flex-wrap brach sie 7 + 1 um, der
 * achte Punkt stand allein darunter (Atelier: vom Fuß angeschnitten). Jetzt liegen die acht in einem Raster mit
 * vier Spalten: zwei gleich lange Reihen. jsdom misst kein Layout; dieser Test prüft die Klassen des Rasters, die
 * Maße und der Umbruch kommen aus der Browsermessung.
 */

afterEach(cleanup);

function Beispiel() {
  const [wert, setWert] = useState<number | null>(null);
  return <ColorPicker legend="Farbe" value={wert} onChange={setWert} />;
}

/** Das Raster: Radioknopf → Wrapper (relative) → Raster. */
function raster(): HTMLElement {
  const wrapper = screen.getAllByRole('radio')[0]?.parentElement;
  const grid = wrapper?.parentElement;
  if (!grid) throw new Error('Raster der Farbwahl fehlt');
  return grid;
}

describe('ColorPicker: acht Farben in zwei gleich langen Reihen', () => {
  it('zeigt acht Radioknöpfe, jeder mit seinem Farbnamen aus de.ts', () => {
    render(<Beispiel />);
    const knoepfe = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(knoepfe.map((k) => k.value)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    de.subjectDialog.colorNames.forEach((name, color) => {
      expect(screen.getByRole('radio', { name }) as HTMLInputElement).toHaveProperty(
        'value',
        String(color),
      );
    });
  });

  it('legt die acht Punkte in ein Raster mit vier Spalten (zwei Reihen zu je vier)', () => {
    render(<Beispiel />);
    const grid = raster();
    expect(grid.classList.contains('grid')).toBe(true);
    expect(grid.classList.contains('grid-cols-4')).toBe(true);
    expect(grid.children).toHaveLength(8);
  });

  it('bricht nicht mehr in einer flex-wrap-Zeile um (kein 7 + 1), jeder Punkt bleibt 44 px', () => {
    render(<Beispiel />);
    const grid = raster();
    expect(grid.classList.contains('flex-wrap')).toBe(false);
    for (const label of Array.from(grid.querySelectorAll('label'))) {
      expect(label.classList.contains('size-11')).toBe(true);
    }
  });
});
