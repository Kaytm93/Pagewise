// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

const TABELLE = [
  '| Spalte A | Spalte B |',
  '| --- | --- |',
  '| kurz | Donaudampfschifffahrtsgesellschaftskapitänskajütenschlüssel |',
].join('\n');

describe('Markdown-Tabellen: lange Wörter brechen in der Zelle (chat-render#09)', () => {
  it('die Tabelle steht table-fixed im scrollenden Rahmen (overflow-x-auto bleibt)', () => {
    render(<Markdown text={TABELLE} />);
    const table = document.querySelector('table');
    if (!table) throw new Error('Keine Tabelle gerendert');
    // Fester Spaltsatz: Spalten bleiben gleich breit, der Rahmen scrollt notfalls selbst.
    expect(table.className).toContain('table-fixed');
    const frame = table.closest('div');
    if (!frame) throw new Error('Kein Tabellenrahmen gerendert');
    expect(frame.className).toContain('overflow-x-auto');
  });

  it('jede Zelle darf beliebig umbrechen und stellt keine Mindestbreite als Forderung', () => {
    render(<Markdown text={TABELLE} />);
    const cells = document.querySelectorAll('table th, table td');
    if (cells.length === 0) throw new Error('Keine Zellen gerendert');
    // overflow-wrap:anywhere senkt die Mindestbreite der Zelle (break-word täte das nicht),
    // min-w-0/max-w-0 halten die Spalten auf dem festen Satz statt Nachbarspalten zu quetschen.
    for (const cell of cells) {
      expect(cell.className).toContain('wrap-anywhere');
      expect(cell.className).toContain('min-w-0');
      expect(cell.className).toContain('max-w-0');
    }
  });
});
