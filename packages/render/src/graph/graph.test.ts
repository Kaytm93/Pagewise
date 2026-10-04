import { describe, expect, it } from 'vitest';
import { RenderError } from '../errors';
import { compileExpression } from './expression';
import { renderGraph, validateGraph } from './index';
import { niceTicks } from './plot';
import { parseGraphSpec } from './spec';

const f = (source: string, x: number) => compileExpression(source)(x);

describe('Ausdrücke', () => {
  it.each([
    ['x^2 - 4', 3, 5],
    ['2x + 1', 3, 7],
    ['2(x+1)', 2, 6],
    ['(x+1)(x-1)', 3, 8],
    ['-x^2', 3, -9],
    ['2^3^2', 0, 512],
    ['x^-2', 2, 0.25],
    ['sqrt(x)', 9, 3],
    ['sin(pi/2)', 0, 1],
    ['abs(x)', -4, 4],
    ['ln(e)', 0, 1],
    ['log(1000)', 0, 3],
    ['1/x', 4, 0.25],
    ['f(x) = x + 1', 1, 2],
    ['y = 3x', 2, 6],
    ['x² + x³', 2, 12],
    ['π', 0, Math.PI],
    ['0,5x', 4, 2],
  ])('%s bei x=%s ergibt %s', (source, x, expected) => {
    expect(f(source, x)).toBeCloseTo(expected as number, 9);
  });

  it('wertet Punkt vor Strich und Klammern richtig aus', () => {
    expect(f('2 + 3 * 4', 0)).toBe(14);
    expect(f('(2 + 3) * 4', 0)).toBe(20);
    expect(f('10 - 4 - 3', 0)).toBe(3);
    expect(f('12 / 3 / 2', 0)).toBe(2);
  });

  it.each([
    '',
    '   ',
    'x +',
    '(x',
    'x)',
    'foo(x)',
    'alert(1)',
    'constructor',
    'process.exit()',
    'x; y',
    'x = = 1',
    'sin x',
    '2 3 +',
    '`x`',
    'x[0]',
    'import("fs")',
  ])('lehnt %j ab', (source) => {
    expect(() => compileExpression(source)).toThrow(RenderError);
  });

  it('führt nie Code aus: Namen aus dem Prototyp sind unbekannt', () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(() => compileExpression(name)).toThrow(RenderError);
      expect(() => compileExpression(`${name}(x)`)).toThrow(RenderError);
    }
  });

  it('begrenzt Länge, Tiefe und Knotenzahl', () => {
    expect(() => compileExpression('x+'.repeat(150) + 'x')).toThrowError(
      expect.objectContaining({ code: 'too_large' }),
    );
    expect(() => compileExpression(`${'('.repeat(60)}x${')'.repeat(60)}`)).toThrowError(
      expect.objectContaining({ code: 'too_complex' }),
    );
    expect(() => compileExpression('-'.repeat(60) + 'x')).toThrowError(
      expect.objectContaining({ code: 'too_complex' }),
    );
    expect(() => compileExpression('x^'.repeat(60) + 'x')).toThrowError(
      expect.objectContaining({ code: 'too_complex' }),
    );
    expect(() => compileExpression('2x'.repeat(99))).toThrowError(
      expect.objectContaining({ code: 'too_complex' }),
    );
  });

  it('gibt für Ungültiges einen festen Code und nie den Eingabetext zurück', () => {
    try {
      compileExpression('geheim(x)');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect(String((error as RenderError).message)).toBe('invalid_expression');
      expect(JSON.stringify(error)).not.toContain('geheim');
    }
  });
});

describe('Graph-Angabe', () => {
  it('liest eine minimale Angabe mit Voreinstellungen', () => {
    const result = parseGraphSpec('{"functions":["x^2"]}');
    expect(result).toMatchObject({
      ok: true,
      value: { x: [-10, 10], y: null, grid: true, points: [] },
    });
  });

  it('liest beschriftete Funktionen, Bereiche und Punkte', () => {
    const result = parseGraphSpec(
      JSON.stringify({
        functions: [{ expr: 'x^2-4', label: 'f' }, 'x'],
        x: [-4, 4],
        y: [-6, 6],
        points: [{ x: 2, y: 0, label: 'N' }],
        grid: false,
      }),
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['kein json', 'invalid_json'],
    ['[]', 'invalid_spec'],
    ['{"functions":[]}', 'invalid_spec'],
    ['{"functions":["x"],"extra":1}', 'invalid_spec'],
    ['{"functions":["x"],"x":[5,1]}', 'invalid_spec'],
    ['{"functions":["x"],"x":[0,10000000]}', 'invalid_spec'],
    ['{"functions":["x","x","x","x","x","x","x"]}', 'invalid_spec'],
    ['{"functions":[1]}', 'invalid_spec'],
    ['{"functions":["x"],"points":[{"x":1}]}', 'invalid_spec'],
    ['{"functions":["x"],"x":[null,1]}', 'invalid_spec'],
  ])('lehnt %j mit %s ab', (source, code) => {
    const result = parseGraphSpec(source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it('lehnt zu große Angaben ab', () => {
    const result = parseGraphSpec(`{"functions":["x"],"pad":"${'a'.repeat(9000)}"}`);
    expect(result).toMatchObject({ ok: false, error: { code: 'too_large' } });
  });

  it('lehnt Steuerzeichen in Beschriftungen ab', () => {
    const result = parseGraphSpec('{"functions":[{"expr":"x","label":"a\\u0001b"}]}');
    expect(result.ok).toBe(false);
  });
});

describe('Zeichnung', () => {
  const draw = (spec: object) => renderGraph(JSON.stringify(spec));

  it('ist deterministisch und enthält Achsen, Kurve und Marke', () => {
    const spec = {
      functions: [{ expr: 'x^2-4', label: 'f(x)' }],
      x: [-4, 4],
      y: [-6, 6],
      points: [{ x: 2, y: 0, label: 'N' }],
    };
    const first = draw(spec);
    expect(draw(spec)).toBe(first);
    expect(first.startsWith('<svg')).toBe(true);
    expect(first).toContain('class="pg-fn pg-fn-0"');
    expect(first).toContain('class="pg-axis"');
    expect(first).toContain('class="pg-point"');
    expect(first).toContain('>f(x)<');
    expect(first).toContain('>−4<');
  });

  it('enthält weder Stilangaben noch Skripte noch Verweise', () => {
    const svg = draw({ functions: [{ expr: 'sin(x)', label: '<script>alert(1)</script>' }] });
    expect(svg).not.toMatch(/<style|<script|style=|href=|onload|onerror|javascript:/i);
    expect(svg).toContain('&#60;script&#62;');
  });

  it('unterbricht an Polstellen statt zu verbinden', () => {
    const svg = draw({ functions: ['1/x'], x: [-5, 5], y: [-5, 5] });
    const d = /class="pg-fn pg-fn-0"[^>]*d="([^"]+)"/.exec(svg)?.[1] ?? '';
    expect((d.match(/M/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('lässt Bereiche weg, in denen die Funktion nicht definiert ist', () => {
    const svg = draw({ functions: ['sqrt(x)'], x: [-4, 4] });
    expect(svg).toContain('pg-fn-0');
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('Infinity');
  });

  it('kommt mit sehr großen und sehr kleinen Werten zurecht', () => {
    expect(draw({ functions: ['x^50'], x: [-10, 10] })).not.toContain('NaN');
    expect(draw({ functions: ['0'], x: [-1, 1] })).toContain('<svg');
    expect(draw({ functions: ['1e300*x'], x: [-1, 1] })).not.toContain('Infinity');
    expect(draw({ functions: ['x'], x: [0.000001, 0.000002], y: [0, 1] })).toContain('<svg');
  });

  it('zeichnet bis zu sechs Funktionen und rechnet nicht ewig', () => {
    const start = Date.now();
    const svg = draw({ functions: ['x', 'x^2', 'x^3', 'sin(x)', 'cos(x)', 'ln(x)'] });
    expect(svg.match(/class="pg-fn pg-fn-\d"/g)?.length).toBe(6);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('wirft bei ungültigem Ausdruck einen festen Fehlercode', () => {
    expect(() => draw({ functions: ['foo(x)'] })).toThrowError(
      expect.objectContaining({ code: 'invalid_expression' }),
    );
  });
});

describe('validateGraph', () => {
  it('liefert null für gültige und den Fehler für ungültige Blöcke', () => {
    expect(validateGraph('{"functions":["x^2"]}')).toBeNull();
    expect(validateGraph('{"functions":["foo(x)"]}')?.code).toBe('invalid_expression');
    expect(validateGraph('{kaputt')?.code).toBe('invalid_json');
  });
});

describe('niceTicks', () => {
  it('teilt in runde Schritte', () => {
    expect(niceTicks(-4, 4)).toEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4]);
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(-0.5, 0.5, 5)).toContain(0);
  });
});
