// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderGraph } from './graph';
import { renderFormula } from './mol';
import { parseMolSpec } from './mol/spec';
import { sanitizeSvg } from './sanitize';

const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;

/** Wurzel der bereinigten Ausgabe, damit geprüft wird, was wirklich im Baum landet. */
function parse(markup: string): Element {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host;
}

describe('SVG bereinigen: XSS-Fälle', () => {
  const attacks: [string, string][] = [
    ['Skriptelement', svg('<script>window.__xss=1</script><circle r="1"/>')],
    [
      'Ereignisattribut onload',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss=1"><circle r="1"/></svg>',
    ],
    ['Ereignisattribut onclick', svg('<circle r="1" onclick="window.__xss=1"/>')],
    ['onerror im Bild', svg('<image href="x" onerror="window.__xss=1"/>')],
    ['Verweis mit javascript:', svg('<a href="javascript:window.__xss=1"><text>x</text></a>')],
    [
      'xlink:href mit javascript:',
      svg('<a xlink:href="javascript:window.__xss=1"><text>x</text></a>'),
    ],
    [
      'foreignObject mit HTML',
      svg(
        '<foreignObject><div onclick="window.__xss=1">x</div><img src=x onerror="window.__xss=1"></foreignObject>',
      ),
    ],
    [
      'Stilelement',
      svg('<style>*{background:url(https://beispiel.invalid/x)}</style><circle r="1"/>'),
    ],
    ['Stilattribut', svg('<circle r="1" style="fill:url(https://beispiel.invalid/x)"/>')],
    ['use mit Fremdadresse', svg('<use href="https://beispiel.invalid/x.svg#a"/>')],
    [
      'use mit Datenadresse',
      svg(
        "<use href=\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' onload='window.__xss=1'/>\"/>",
      ),
    ],
    [
      'Animation setzt href',
      svg('<a><set attributeName="href" to="javascript:window.__xss=1"/><text>x</text></a>'),
    ],
    [
      'animate setzt onclick',
      svg('<circle r="1"><animate attributeName="onclick" values="window.__xss=1"/></circle>'),
    ],
    [
      'verschachtelt, kaputtes Markup',
      '<svg><svg><script>window.__xss=1</script></svg><circle r=1 onload=window.__xss=1></svg>',
    ],
    ['HTML im Text', svg('<text><iframe src="javascript:window.__xss=1"></iframe></text>')],
    [
      'Formular',
      svg(
        '<foreignObject><form action="https://beispiel.invalid"><input name="a"></form></foreignObject>',
      ),
    ],
    [
      'Grossbuchstaben und Leerraum',
      '<svg xmlns="http://www.w3.org/2000/svg"><SCRIPT >window.__xss=1</SCRIPT><circle r="1" ONLOAD = "window.__xss=1"/></svg>',
    ],
    [
      'mathml-Einschleusung',
      svg(
        '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=x onerror=window.__xss=1&gt;">',
      ),
    ],
  ];

  it.each(attacks)('neutralisiert: %s', (_name, input) => {
    (window as unknown as { __xss?: number }).__xss = undefined;
    let output: string;
    try {
      output = sanitizeSvg(input);
    } catch (error) {
      // Ein Fehler ist ebenfalls sicher (nichts wird gezeichnet)
      expect(error).toMatchObject({ code: 'render_failed' });
      return;
    }
    const root = parse(output);
    expect(
      root.querySelectorAll(
        'script, style, foreignObject, use, image, a, set, animate, iframe, form, input, math',
      ).length,
    ).toBe(0);
    for (const element of root.querySelectorAll('*')) {
      for (const attribute of element.getAttributeNames()) {
        expect(attribute, `Attribut ${attribute}`).not.toMatch(/^on/i);
        expect(['style', 'href', 'xlink:href', 'src']).not.toContain(attribute.toLowerCase());
      }
    }
    expect(output).not.toMatch(/javascript:|beispiel\.invalid|__xss|onerror|onload|onclick/i);
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it('lässt harmlose Zeichnungen unverändert durch (Klassen, Pfade, Text, viewBox)', () => {
    const input = svg(
      '<g class="a"><path d="M0 0L5 5" stroke="currentColor" fill="none"/><text x="1" y="2" font-size="12">H₂O</text><circle cx="1" cy="1" r="1"/></g>',
    );
    const output = sanitizeSvg(input);
    expect(output).toContain('viewBox="0 0 10 10"');
    expect(output).toContain('class="a"');
    expect(output).toContain('d="M0 0L5 5"');
    expect(output).toContain('H₂O');
    expect(output).toContain('<circle');
  });

  it('lässt die eigenen Zeichnungen (Graph, Molekül) unverändert durch', () => {
    const graph = renderGraph(
      '{"functions":[{"expr":"x^2","label":"f"}],"points":[{"x":1,"y":1,"label":"P"}]}',
    );
    // Gleicher Baum (die Schreibweise der Zeichenfolge darf sich ändern, der Inhalt nicht)
    expect(parse(sanitizeSvg(graph)).innerHTML).toBe(parse(graph).innerHTML);
    const parsed = parseMolSpec('H2O');
    if (!parsed.ok) throw parsed.error;
    const mol = renderFormula(parsed.value);
    const cleaned = sanitizeSvg(mol);
    expect(cleaned).toContain('class="pg-lp"');
    expect(cleaned).toContain('class="pg-atom"');
  });

  it('lehnt etwas ab, das kein SVG ist', () => {
    expect(() => sanitizeSvg('<img src=x onerror=alert(1)>')).toThrowError(
      expect.objectContaining({ code: 'render_failed' }),
    );
    expect(() => sanitizeSvg('')).toThrow();
    expect(() => sanitizeSvg('<div>kein svg</div>')).toThrow();
  });

  it('lehnt riesige Eingaben ab', () => {
    expect(() => sanitizeSvg(svg('a'.repeat(2_100_000)))).toThrowError(
      expect.objectContaining({ code: 'too_large' }),
    );
  });
});
