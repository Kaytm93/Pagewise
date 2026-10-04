// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { Markdown } from './screens/chat/Markdown';

beforeAll(async () => {
  // Die Blöcke sind nachgeladene Pakete; in Tests vorab laden, damit sie nicht an der Wartezeit scheitern.
  await Promise.all([
    import('./screens/chat/blocks/MathView'),
    import('./screens/chat/blocks/BlockView'),
    import('@pagewise/render/graph'),
    import('@pagewise/render/mol'),
    import('@pagewise/render/sanitize'),
    import('@pagewise/render/math-dom'),
  ]);
}, 30_000);

const show = (text: string, final = true) => render(<Markdown text={text} final={final} />);

describe('Formeln', () => {
  it('zeichnet Formeln im Text und als Absatz mit KaTeX', async () => {
    const { container } = show('Es gilt $a^2+b^2=c^2$ im Dreieck.\n\n$$\\frac{1}{2}$$');
    await waitFor(() => expect(container.querySelectorAll('.katex').length).toBe(2));
    expect(container.querySelector('.katex-display')).not.toBeNull();
    // Der Satz um die Formel bleibt Text
    expect(container.textContent).toContain('Es gilt');
    // Der MathML-Teil für Screenreader ist da, der TeX-Quelltext steht nicht doppelt sichtbar
    expect(container.querySelector('.katex-mathml math')).not.toBeNull();
    expect(container.querySelector('annotation')).toBeNull();
  });

  it('zeigt eine fehlerhafte Formel nach Abschluss mit Meldung, im Text als Quelltext', async () => {
    const { container } = show('Kaputt $\\frac{1$ und\n\n$$\\unbekannt{x}$$');
    await waitFor(() => expect(container.querySelector('[data-block-error]')).not.toBeNull());
    expect(container.querySelector('[data-block-error]')?.getAttribute('data-block-error')).toBe(
      'invalid_math',
    );
    expect(container.textContent).toContain('Formel konnte nicht gezeichnet werden.');
    expect(container.textContent).toContain('Die Formel enthält einen Fehler.');
    expect(container.textContent).toContain('$\\frac{1$');
  });

  it('zeigt während des Schreibens keine Fehlermeldung', async () => {
    const { container } = show('$$\\frac{1', false);
    await waitFor(() => expect(container.querySelector('pre')).not.toBeNull());
    expect(container.querySelector('[data-block-error]')).toBeNull();
    expect(container.textContent).not.toContain('konnte nicht gezeichnet werden');
  });
});

describe('Graph, Molekül, Noten', () => {
  it('zeichnet einen Funktionsgraphen', async () => {
    const { container } = show(
      '```graph\n{"functions":[{"expr":"x^2-4","label":"f"}],"x":[-4,4],"y":[-6,6],"points":[{"x":2,"y":0,"label":"N"}]}\n```',
    );
    await waitFor(() => expect(container.querySelector('svg.pg-graph')).not.toBeNull());
    expect(container.querySelector('svg .pg-fn-0')).not.toBeNull();
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'Funktionsgraph',
    );
  });

  it('meldet einen unlesbaren Ausdruck mit festem Text und zeigt den Quelltext', async () => {
    const { container } = show('```graph\n{"functions":["geheim(x)"]}\n```');
    await waitFor(() => expect(container.querySelector('[data-block-error]')).not.toBeNull());
    expect(container.querySelector('[data-block-error]')?.getAttribute('data-block-error')).toBe(
      'invalid_expression',
    );
    expect(container.textContent).toContain('Funktionsgraph konnte nicht gezeichnet werden.');
    expect(container.textContent).toContain('Ein Ausdruck lässt sich nicht lesen.');
    expect(container.querySelector('pre')?.textContent).toContain('geheim(x)');
  });

  it('zeichnet Wasser als Valenzstrichformel', async () => {
    const { container } = show('```mol\nH2O\n```');
    await waitFor(() => expect(container.querySelector('svg.pg-mol')).not.toBeNull());
    expect(container.querySelectorAll('.pg-lp').length).toBe(2);
    expect(container.textContent).toContain('H₂O');
  });

  it('erklärt, wenn eine Summenformel unbekannt ist', async () => {
    const { container } = show('```mol\nC8H18\n```');
    await waitFor(() => expect(container.querySelector('[data-block-error]')).not.toBeNull());
    expect(container.textContent).toContain('SMILES');
  });

  it('lehnt eine ungültige SMILES-Angabe ab', async () => {
    const { container } = show('```mol\nsmiles: C(C\n```');
    await waitFor(() => expect(container.querySelector('[data-block-error]')).not.toBeNull());
    expect(container.querySelector('[data-block-error]')?.getAttribute('data-block-error')).toBe(
      'invalid_smiles',
    );
  });

  it('lehnt Fließtext statt Noten ab', async () => {
    const { container } = show('```abc\ndas ist kein abc\n```');
    await waitFor(() => expect(container.querySelector('[data-block-error]')).not.toBeNull());
    expect(container.querySelector('[data-block-error]')?.getAttribute('data-block-error')).toBe(
      'invalid_abc',
    );
  });

  it('lässt andere Codeblöcke Code bleiben (mit Kopierknopf)', () => {
    const { container, getAllByRole } = show(
      '```js\nconst a = 1;\n```\n\n```svg\n<svg onload="x()"></svg>\n```',
    );
    expect(container.querySelectorAll('pre').length).toBe(2);
    // Kein gezeichnetes SVG (das Symbol des Kopierknopfs ist kein Teil des Blocks)
    expect(container.querySelector('.pg-svg, pre svg')).toBeNull();
    expect(getAllByRole('button', { name: 'Code kopieren' })).toHaveLength(2);
  });
});

describe('Hinweiskästen', () => {
  it.each([
    ['merksatz', 'Merksatz'],
    ['beispiel', 'Beispiel'],
    ['aufgabe', 'Aufgabe'],
    ['definition', 'Definition'],
  ])('macht aus [!%s] einen Kasten mit Beschriftung %s', (kind, label) => {
    const { container } = show(`> [!${kind}]\n> Der eigentliche Inhalt mit **Betonung**.`);
    const box = container.querySelector(`aside[data-callout="${kind}"]`);
    expect(box).not.toBeNull();
    expect(box?.textContent).toContain(label);
    expect(box?.textContent).toContain('Der eigentliche Inhalt mit Betonung.');
    expect(box?.textContent).not.toContain('[!');
    expect(box?.querySelector('strong')).not.toBeNull();
  });

  it('erkennt die Art auch groß geschrieben und mit Text in derselben Zeile', () => {
    const { container } = show('> [!MERKSATZ] Gleiche Zeile');
    expect(container.querySelector('aside[data-callout="merksatz"]')?.textContent).toContain(
      'Gleiche Zeile',
    );
  });

  it('lässt gewöhnliche Zitate und unbekannte Arten Zitate bleiben', () => {
    const { container } = show('> Ein Zitat\n\n> [!wichtig]\n> Unbekannte Art');
    expect(container.querySelectorAll('blockquote').length).toBe(2);
    expect(container.querySelector('aside')).toBeNull();
  });
});

describe('Sichere Darstellung der Blöcke', () => {
  const hostile = [
    '```graph\n{"functions":[{"expr":"x","label":"<img src=x onerror=\\"window.__angriff=1\\">"}],"points":[{"x":0,"y":0,"label":"<script>window.__angriff=2</script>"}]}\n```',
    '```mol\nformel: H2O\nbeschriftung: <img src=x onerror="window.__angriff=3">\n```',
    '```abc\nX:1\nT:<script>window.__angriff=4</script>\nK:C\nCDEF|\n```',
    '$$\\text{<img src=x onerror="window.__angriff=5">}$$',
    'Text $\\text{<script>window.__angriff=6</script>}$',
    '> [!merksatz]\n> <img src=x onerror="window.__angriff=7"> [x](javascript:window.__angriff=8)',
    '```svg\n<svg xmlns="http://www.w3.org/2000/svg" onload="window.__angriff=9"><script>window.__angriff=10</script></svg>\n```',
  ].join('\n\n');

  it('führt nichts aus und bringt kein Markup ins DOM', async () => {
    const { container } = show(hostile);
    // Warten, bis die Blöcke gezeichnet oder abgelehnt sind
    await waitFor(() => expect(container.querySelectorAll('[aria-busy="true"]').length).toBe(0), {
      timeout: 8000,
    });
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(container.querySelector('foreignObject, iframe, object, embed')).toBeNull();
    for (const link of container.querySelectorAll('a')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
    }
    expect((window as unknown as { __angriff?: number }).__angriff).toBeUndefined();
    // Der Text der Beschriftungen steht als Text da, nicht als Markup
    expect(container.textContent).toContain('<img src=x');
  });
});
