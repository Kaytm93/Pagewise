// @vitest-environment jsdom
import { renderGraph } from '@pagewise/render/graph';
import { parseMolSpec, renderFormula } from '@pagewise/render/mol';
import { describe, expect, it } from 'vitest';
import { printSvg } from './raster';

describe('printSvg', () => {
  it('gibt dem Graph Druckfarben als Attribute und eine feste Größe', () => {
    const svg = renderGraph('{"functions":["x^2-4"],"x":[-4,4],"y":[-6,6]}');
    const printed = printSvg(svg);
    expect(printed).not.toBeNull();
    expect(printed?.width).toBe(480);
    expect(printed?.height).toBe(320);
    const text = printed?.text ?? '';
    expect(text).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(text).toContain('stroke="#c9c9c9"');
    expect(text).toContain('stroke="#1f1f1f"');
    expect(text).not.toContain('<style');
    expect(text).not.toContain('var(--');
  });

  it('ersetzt currentColor beim Molekül', () => {
    const spec = parseMolSpec('H2O');
    if (!spec.ok) throw spec.error;
    const printed = printSvg(renderFormula(spec.value));
    expect(printed?.text).not.toContain('currentColor');
    expect(printed?.text).toContain('stroke="#1f1f1f"');
    expect(printed?.width).toBeGreaterThan(50);
  });

  it('lehnt etwas ab, das kein SVG ist', () => {
    expect(printSvg('<p>Hallo</p>')).toBeNull();
    expect(printSvg('kein xml <')).toBeNull();
  });
});
