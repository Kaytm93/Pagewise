import { describe, expect, it } from 'vitest';
import { parseChartSpec, renderChart } from './chart';
import { parseDocumentSpec } from './document';

// Alle Inhalte sind erfunden.
const chart = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'bar',
    categories: ['Mo', 'Di', 'Mi'],
    series: [{ name: 'Beispiel', values: [3, 5, 2.5] }],
    unit: '°C',
    ...overrides,
  });
const failure = (source: string) => {
  const result = parseChartSpec(source);
  if (result.ok) throw new Error('sollte scheitern');
  return `${result.error.code}${result.error.detail ? `:${result.error.detail}` : ''}`;
};

describe('Diagramm', () => {
  it('zeichnet Balken mit Beschriftungen und einer Einheit', () => {
    const svg = renderChart(chart());
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect((svg.match(/<rect /g) ?? []).length).toBe(3);
    expect(svg).toContain('>Mo<');
    expect(svg).toContain('°C');
  });

  it('zeichnet Linien mit mehreren Reihen und Legende', () => {
    const svg = renderChart(
      chart({
        type: 'line',
        series: [
          { name: 'A', values: [1, 2, 3] },
          { name: 'B', values: [3, 2, 1] },
        ],
      }),
    );
    expect((svg.match(/<path /g) ?? []).length).toBe(2);
    expect(svg).toContain('>A<');
  });

  it('zeichnet ein Kreisdiagramm mit Prozentwerten', () => {
    const svg = renderChart(
      chart({ type: 'pie', unit: undefined, series: [{ name: 'S', values: [1, 1, 2] }] }),
    );
    expect((svg.match(/<path /g) ?? []).length).toBe(3);
    expect(svg).toContain('50 %');
  });

  it('kommt mit negativen Werten und nur einer Rubrik zurecht', () => {
    expect(() =>
      renderChart(chart({ categories: ['A'], series: [{ name: 'S', values: [-4] }] })),
    ).not.toThrow();
  });

  it('maskiert Text aus dem Diagramm', () => {
    const svg = renderChart(chart({ categories: ['<b>&', 'x', 'y'] }));
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;b&gt;&amp;');
  });

  it('lehnt falsche Eingaben mit festen Codes ab', () => {
    expect(failure('kaputt')).toBe('invalid_json');
    expect(failure(chart({ type: 'donut' }))).toBe('invalid_chart:type');
    expect(failure(chart({ series: [{ name: 'S', values: [1, 2] }] }))).toBe(
      'invalid_chart:values',
    );
    expect(failure(chart({ type: 'pie', series: [{ name: 'S', values: [0, 0, 0] }] }))).toBe(
      'invalid_chart:values',
    );
    expect(failure(chart({ type: 'pie', series: [{ name: 'S', values: [1, -1, 3] }] }))).toBe(
      'invalid_chart:values',
    );
    expect(
      failure(
        chart({
          type: 'pie',
          series: [
            { name: 'a', values: [1, 1, 1] },
            { name: 'b', values: [1, 1, 1] },
          ],
        }),
      ),
    ).toBe('invalid_chart:series');
    expect(failure(chart({ categories: [] }))).toBe('invalid_chart:categories');
    expect(failure(chart({ extra: 1 }))).toBe('invalid_chart');
    expect(failure(chart({ series: [{ name: 'S', values: [1, Number.NaN, 2] }] }))).toBe(
      'invalid_chart:values',
    );
  });
});

describe('Diagramm als Abbildung im Dokument', () => {
  it('nimmt ein Diagramm als Objekt und speichert den Quelltext', () => {
    const result = parseDocumentSpec(
      JSON.stringify({
        title: 'Beispiel',
        parts: [
          {
            type: 'chart',
            chart: { type: 'bar', categories: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
            caption: 'Werte',
          },
        ],
      }),
    );
    expect(result.ok && result.value.parts[0]).toMatchObject({ type: 'figure', kind: 'chart' });
  });

  it('meldet ein kaputtes Diagramm schon beim Lesen des Dokuments', () => {
    const result = parseDocumentSpec(
      JSON.stringify({ title: 'T', parts: [{ type: 'chart', chart: { type: 'bar' } }] }),
    );
    expect(result.ok).toBe(false);
  });
});
