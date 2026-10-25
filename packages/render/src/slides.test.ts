import { describe, expect, it } from 'vitest';
import { extractBlocks } from './blocks';
import { LIMITS } from './errors';
import { parseSlidesSpec, validateSlides } from './slides';
import { validateMarkdown } from './validate';

const deck = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: 'Wasser (erfunden)',
    slides: [
      {
        title: 'Stoffe',
        bullets: ['H₂O', 'Sauerstoff', 'Wasserstoff'],
        text: 'Erfundene Beispielfolie.',
      },
      { title: 'Ende' },
    ],
    ...overrides,
  });

describe('Folien-Angabe', () => {
  it('liest Titel, Folien, Stichpunkte und Absatz; Unicode ist erlaubt', () => {
    expect(parseSlidesSpec(deck())).toEqual({
      ok: true,
      value: {
        title: 'Wasser (erfunden)',
        slides: [
          {
            title: 'Stoffe',
            bullets: ['H₂O', 'Sauerstoff', 'Wasserstoff'],
            text: 'Erfundene Beispielfolie.',
          },
          { title: 'Ende', bullets: [], text: undefined },
        ],
      },
    });
  });

  it.each([
    ['', 'empty', undefined],
    ['{', 'invalid_json', undefined],
    [deck({ extra: 1 }), 'invalid_slides', undefined],
    [deck({ slides: [] }), 'invalid_slides', 'slides'],
    [deck({ slides: [{ bullets: ['x'] }] }), 'invalid_slides', 'text'],
    [deck({ slides: [{ title: 'x', image: 'y' }] }), 'invalid_slides', 'slides'],
    [deck({ slides: [{ title: '' }] }), 'invalid_slides', 'text'],
    [deck({ slides: [{ title: 'x', bullets: 'eins' }] }), 'invalid_slides', 'bullets'],
    [deck({ slides: [{ title: 'x', bullets: Array(7).fill('a') }] }), 'invalid_slides', 'bullets'],
    [deck({ slides: [{ title: 'x', bullets: ['y'.repeat(121)] }] }), 'invalid_slides', 'text'],
    [deck({ slides: [{ title: 'x', text: 'a\nb' }] }), 'invalid_slides', 'text'],
    [
      deck({ slides: Array.from({ length: 21 }, () => ({ title: 'x' })) }),
      'invalid_slides',
      'slides',
    ],
  ])('lehnt %j ab (%s, Hinweis %s)', (source, code, detail) => {
    const result = parseSlidesSpec(source);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.detail).toBe(detail);
    }
  });

  it('begrenzt die Größe', () => {
    expect(parseSlidesSpec(deck({ title: 'x'.repeat(LIMITS.slides) }))).toMatchObject({
      ok: false,
      error: { code: 'too_large' },
    });
  });

  it('prüft ohne Befund, wenn alles in Ordnung ist', () => {
    expect(validateSlides(deck())).toBeNull();
    expect(validateSlides('{}')?.code).toBe('invalid_slides');
  });
});

describe('Folien im Text', () => {
  it('erkennt den Block und meldet ihn mit Art und Nummer', async () => {
    expect(extractBlocks(`\`\`\`slides\n${deck()}\n\`\`\``)).toEqual([
      expect.objectContaining({ kind: 'slides', index: 1 }),
    ]);
    expect(await validateMarkdown(`\`\`\`slides\n${deck()}\n\`\`\``)).toEqual([]);
    const issues = await validateMarkdown('```slides\n{"title":"x","slides":[]}\n```');
    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'slides',
        index: 1,
        code: 'invalid_slides',
        detail: 'slides',
      }),
    ]);
  });
});
