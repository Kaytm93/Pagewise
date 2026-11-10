// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { de } from '../i18n/de';
import { ColorPicker } from './ColorPicker';
import { IconPicker } from './IconPicker';

/*
 * B-16 (D-097): Die Farbwahl hat acht Punkte zu je 44 px. In einer Zeile mit flex-wrap brach sie 7 + 1 um, der
 * achte Punkt stand allein darunter (Atelier: vom Fuß angeschnitten). Danach lagen die acht in einem Raster mit
 * vier Spalten: zwei gleich lange Reihen. D-117 (Kay, 7. November 2026): „Enger setzen, bündig“: Das Raster ist
 * das der Symbolwahl (fünf Spalten, gleiche Abstände); die zwei Reihen zu vier beginnen in der ersten Spalte und
 * stehen so auf den ersten vier Symbolspalten. jsdom misst kein Layout; dieser Test prüft die Klassen des
 * Rasters, die Maße und die Mittelpunkte kommen aus der Browsermessung.
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

  it('legt die acht Punkte in zwei Reihen zu je vier, jede Reihe beginnt in der ersten Spalte', () => {
    render(<Beispiel />);
    const grid = raster();
    expect(grid.classList.contains('grid')).toBe(true);
    expect(grid.children).toHaveLength(8);
    const reihenanfang = Array.from(grid.children)
      .map((kind, index) => (kind.classList.contains('col-start-1') ? index : -1))
      .filter((index) => index >= 0);
    expect(reihenanfang).toEqual([0, 4]);
  });

  it('hat dasselbe Raster wie die Symbolwahl: gleiche Spaltenzahl und gleiche Abstände (D-117)', () => {
    const symbole = render(<IconPicker legend="Symbol" value="book" onChange={() => {}} />);
    const symbolRaster = screen.getAllByRole('radio')[0]?.parentElement?.parentElement;
    const spalten = (el: Element | null | undefined) =>
      Array.from(el?.classList ?? []).filter((name) => /^(grid-cols-|gap-)/.test(name));
    expect(spalten(symbolRaster).length).toBeGreaterThanOrEqual(2);
    const erwartet = spalten(symbolRaster).sort();
    symbole.unmount();
    render(<Beispiel />);
    expect(spalten(raster()).sort()).toEqual(erwartet);
  });

  it('gibt jedem Punkt dieselbe Zelle wie jedem Symbol: Wrapper relative, Knopf 44 px links in der Zelle', () => {
    render(<Beispiel />);
    for (const kind of Array.from(raster().children)) {
      expect(kind.classList.contains('relative')).toBe(true);
      expect(kind.querySelector('label')?.classList.contains('size-11')).toBe(true);
    }
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
