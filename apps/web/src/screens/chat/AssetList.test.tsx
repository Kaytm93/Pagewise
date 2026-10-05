// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChatAsset } from '../../api/types';
import { AssetList } from './AssetList';

function asset(name: string): ChatAsset {
  return { id: 'a1', name, kind: 'text', mime: 'text/plain', size: 2048 };
}

function knopfOf(container: HTMLElement): HTMLAnchorElement {
  const knopf = container.querySelector('a');
  if (!knopf) throw new Error('Kein Dateiknopf gerendert');
  return knopf;
}

function spansOf(knopf: HTMLAnchorElement): [HTMLSpanElement, HTMLSpanElement] {
  const spans = Array.from(knopf.querySelectorAll('span'));
  if (spans.length !== 2 || !spans[0] || !spans[1]) throw new Error('Erwartet: genau zwei Spans');
  return [spans[0], spans[1]];
}

describe('AssetList: Dateiname im Dateiknopf', () => {
  it('langer Name: Endungs-Span hat shrink-0 und enthält die Endung, Namens-Span hat truncate, Knopf hat title', () => {
    const { container } = render(
      <AssetList
        assets={[asset('Sehr-langer-Beispieldateiname-fuer-den-Regietest.pdf')]}
        url={() => '#'}
      />,
    );
    const knopf = knopfOf(container);
    expect(knopf.getAttribute('title')).toBe(
      'Sehr-langer-Beispieldateiname-fuer-den-Regietest.pdf',
    );

    const [nameSpan, extSpan] = spansOf(knopf);
    expect(nameSpan.className).toContain('truncate');
    expect(nameSpan.className).toContain('min-w-0');
    expect(extSpan.className).toContain('shrink-0');
    expect(extSpan.textContent).toContain('.pdf');
    expect(extSpan.textContent).toContain('2 KB');
  });

  it('kurzer Name: gleiche Struktur, Endung bleibt sichtbar, title mit vollem Namen', () => {
    const { container } = render(<AssetList assets={[asset('Notiz.md')]} url={() => '#'} />);
    const knopf = knopfOf(container);
    expect(knopf.getAttribute('title')).toBe('Notiz.md');
    const [nameSpan, extSpan] = spansOf(knopf);
    expect(nameSpan.className).toContain('truncate');
    expect(extSpan.className).toContain('shrink-0');
    expect(extSpan.textContent).toContain('.md');
  });

  it('ohne Endung: leerer Endungs-Text, title mit vollem Namen', () => {
    const { container } = render(<AssetList assets={[asset('Liesmich')]} url={() => '#'} />);
    const knopf = knopfOf(container);
    expect(knopf.getAttribute('title')).toBe('Liesmich');
    const [, extSpan] = spansOf(knopf);
    expect(extSpan.textContent).not.toContain('.');
    expect(extSpan.textContent).toContain('2 KB');
  });
});
