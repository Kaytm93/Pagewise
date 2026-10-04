// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { katexHtml, validateMath } from './math';
import { applyInlineStyles, extractInlineStyles } from './math-dom';

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
