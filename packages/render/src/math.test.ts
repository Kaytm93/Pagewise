// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { katexHtml, validateMath } from './math';
import { applyInlineStyles, extractInlineStyles, renderMathInto } from './math-dom';

describe('Formeln', () => {
  it('rendert gültige Formeln', () => {
    expect(katexHtml('\\frac{a+b}{c}', false)).toContain('katex');
    expect(katexHtml('\\sum_{i=1}^{n} i', true)).toContain('katex-display');
    expect(validateMath('x^2 + y^2 = r^2', false)).toBeNull();
    expect(validateMath('\\ce{H2O}', false)?.code).toBe('invalid_math');
  });

  it('meldet Fehler mit festem Code und höchstens einer Position', () => {
    const error = validateMath('\\frac{1', false);
    expect(error?.code).toBe('invalid_math');
    expect(error?.detail ?? '').toMatch(/^\d*$/);
    expect(validateMath('\\unbekannterbefehl{x}', false)?.code).toBe('invalid_math');
    expect(JSON.stringify(validateMath('\\unbekannterbefehl{x}', false))).not.toContain(
      'unbekannterbefehl',
    );
  });

  it('lehnt leere und zu lange Formeln ab', () => {
    expect(validateMath('   ', false)?.code).toBe('empty');
    expect(validateMath('x'.repeat(2001), false)?.code).toBe('too_large');
  });

  it('erlaubt keine Links, Bilder und keine Stilangaben von außen (kein trust)', () => {
    expect(validateMath('\\href{https://beispiel.invalid}{x}', false)).not.toBeNull();
    expect(validateMath('\\includegraphics{x.png}', false)).not.toBeNull();
    expect(validateMath('\\htmlStyle{color:red}{x}', false)).not.toBeNull();
    expect(validateMath('\\htmlClass{a}{x}', false)).not.toBeNull();
  });

  it('begrenzt Makroschleifen und riesige Größen', () => {
    expect(validateMath('\\def\\a{\\a\\a}\\a', false)).not.toBeNull();
    // Größen werden gekappt, nicht abgelehnt
    const styles =
      katexHtml('\\rule{1000em}{1000em}', false)
        .match(/style="[^"]*"/g)
        ?.join(' ') ?? '';
    expect(styles).not.toContain('1000');
  });
});

describe('Stilangaben herausnehmen (CSP)', () => {
  const html = katexHtml('\\frac{a}{b} + \\sqrt{x}', false);

  it('KaTeX setzt Stilangaben, die die CSP blockieren würde', () => {
    expect(html).toContain('style="');
  });

  it('nimmt sie aus dem HTML heraus und gibt sie getrennt zurück', () => {
    const { html: clean, styles } = extractInlineStyles(html);
    expect(clean).not.toMatch(/style=/i);
    expect((clean.match(/data-pgs=/g) ?? []).length).toBe(styles.length);
    expect(styles.length).toBeGreaterThan(3);
    const properties = new Set(styles.flatMap(([, declarations]) => declarations.map(([p]) => p)));
    expect(properties.has('height')).toBe(true);
    expect(properties.has('vertical-align')).toBe(true);
  });

  it('setzt sie nach dem Einhängen über das CSSOM', () => {
    const { html: clean, styles } = extractInlineStyles(html);
    const root = document.createElement('div');
    root.innerHTML = clean;
    expect(root.querySelectorAll('[style]').length).toBe(0);
    applyInlineStyles(root, styles);
    expect(root.querySelectorAll('[data-pgs]').length).toBe(0);
    const withStyle = [...root.querySelectorAll('*')].filter(
      (element) => (element as HTMLElement).style?.length > 0,
    );
    expect(withStyle.length).toBe(styles.length);
  });

  it('übernimmt nur bekannte Eigenschaften und unauffällige Werte', () => {
    const hostile =
      '<span style="height:2em;background:url(https://beispiel.invalid/x);position:fixed;color:red;width:expression(alert(1))">x</span>';
    const { styles } = extractInlineStyles(hostile);
    expect(styles).toEqual([
      [
        0,
        [
          ['height', '2em'],
          ['color', 'red'],
        ],
      ],
    ]);
  });
});

describe('Formeln einhängen', () => {
  it('rendert in ein Element, ohne style-Attribute, mit Stilangaben über das CSSOM', () => {
    const host = document.createElement('div');
    renderMathInto(host, '\\frac{a+b}{c} = \\sqrt{x}', false);
    expect(host.querySelector('.katex')).not.toBeNull();
    // Die Angaben sind jetzt CSSOM-Eigenschaften (jsdom spiegelt sie auch ins Attribut, der Browser mit CSP
    // bewertet nur das, was beim Parsen im Text stand).
    const styled = [...host.querySelectorAll('*')].filter(
      (el) => (el as HTMLElement).style?.length > 0,
    );
    expect(styled.length).toBeGreaterThan(3);
  });

  it('behält den MathML-Teil für Screenreader und entfernt den TeX-Quelltext aus der Annotation', () => {
    const host = document.createElement('div');
    renderMathInto(host, 'a_1 + b', false);
    expect(host.querySelector('.katex-mathml math')).not.toBeNull();
    expect(host.querySelector('annotation')).toBeNull();
    // Der Quelltext steht nicht doppelt als sichtbarer Text da
    expect(host.querySelector('.katex-mathml')?.textContent).not.toContain('a_1');
  });

  it('lässt bei einer ungültigen Formel den Inhalt unverändert und wirft', () => {
    const host = document.createElement('div');
    host.textContent = 'vorher';
    expect(() => renderMathInto(host, '\\frac{1', false)).toThrowError(
      expect.objectContaining({ code: 'invalid_math' }),
    );
    expect(host.textContent).toBe('vorher');
  });

  it('bringt Markup im Formeltext nicht ins DOM', () => {
    const host = document.createElement('div');
    for (const latex of [
      '\\text{<img src=x onerror="window.__xss=1">}',
      '\\text{<script>window.__xss=1</script>}',
      'x < y > z \\& \\text{a <b>c</b>}',
    ]) {
      try {
        renderMathInto(host, latex, false);
      } catch {
        // Ablehnen ist ebenfalls sicher
      }
      expect(host.querySelector('img, script, b')).toBeNull();
      expect(host.innerHTML).not.toMatch(/onerror=/i);
    }
  });
});
