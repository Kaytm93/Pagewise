import { describe, expect, it } from 'vitest';
import { extractBlocks } from './blocks';
import { isPdfText, parseDocumentSpec, validateDocument } from './document';
import { LIMITS } from './errors';
import { validateMarkdown } from './validate';

const doc = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: 'Arbeitsblatt Wasser (erfunden)',
    parts: [
      { type: 'heading', text: 'Aufgabe 1' },
      { type: 'paragraph', text: 'Nenne die Formel von Wasser.' },
      { type: 'list', items: ['Wasserstoff', 'Sauerstoff'] },
    ],
    ...overrides,
  });

describe('Dokument-Angabe', () => {
  it('liest Titel und die drei Abschnittsarten', () => {
    expect(parseDocumentSpec(doc())).toEqual({
      ok: true,
      value: {
        title: 'Arbeitsblatt Wasser (erfunden)',
        parts: [
          { type: 'heading', text: 'Aufgabe 1' },
          { type: 'paragraph', text: 'Nenne die Formel von Wasser.' },
          { type: 'list', items: ['Wasserstoff', 'Sauerstoff'] },
        ],
      },
    });
  });

  it('nimmt Umlaute und die Zusatzzeichen der Schrift', () => {
    expect(isPdfText('Größe „Äpfel“ – 5 € … ß')).toBe(true);
    const result = parseDocumentSpec(doc({ title: 'Übungen für Schüler' }));
    expect(result.ok).toBe(true);
  });

  it('nimmt Formeln mit Indizes, Ladungen und Pfeil im Block', () => {
    const chemistry = doc({
      title: 'Silbernitrat (AgNO₃)',
      parts: [{ type: 'paragraph', text: 'AgNO₃ + NaCl → AgCl + NaNO₃, Ag⁺ und NO₃⁻ sind Ionen.' }],
    });
    expect(parseDocumentSpec(chemistry).ok).toBe(true);
  });

  it.each(['H₂O', 'Ag⁺ und NO₃⁻', 'SO₄²⁻', 'AgNO₃ + NaCl → AgCl + NaNO₃', '2 − 1 ≤ 3 ≥ 0 ≈ 1'])(
    'nimmt Indizes, Ladungen und Mathezeichen in %j',
    (text) => {
      expect(isPdfText(text)).toBe(true);
    },
  );

  it.each(['Δ H', 'Gleichgewicht ⇌ Ende', 'Zeile\numbruch', 'Tab\tsei', 'Test 🙂'])(
    'lehnt Zeichen in %j ab',
    (text) => {
      expect(isPdfText(text)).toBe(false);
    },
  );

  it.each([
    ['', 'empty', undefined],
    ['{', 'invalid_json', undefined],
    ['[]', 'invalid_document', undefined],
    [doc({ extra: 1 }), 'invalid_document', undefined],
    [doc({ title: '' }), 'invalid_document', 'text'],
    [doc({ parts: [] }), 'invalid_document', 'parts'],
    [doc({ parts: [{ type: 'bild', text: 'x' }] }), 'invalid_document', 'parts'],
    [doc({ parts: [{ type: 'heading', text: 'x', level: 2 }] }), 'invalid_document', 'parts'],
    [doc({ parts: [{ type: 'list', items: [] }] }), 'invalid_document', 'items'],
    [doc({ parts: [{ type: 'paragraph', text: 'a\nb' }] }), 'invalid_document', 'text'],
    [doc({ parts: [{ type: 'paragraph', text: 'x'.repeat(1201) }] }), 'invalid_document', 'text'],
    [doc({ parts: [{ type: 'paragraph', text: 'Formel Δ H' }] }), 'unsupported_text', 'U+0394'],
    [doc({ parts: [{ type: 'list', items: ['Ziel ⇌ Ende'] }] }), 'unsupported_text', 'U+21CC'],
    [doc({ parts: [{ type: 'paragraph', text: 'Steuer\u0007' }] }), 'invalid_document', 'text'],
  ])('lehnt %j ab (%s, Hinweis %s)', (source, code, detail) => {
    const result = parseDocumentSpec(source);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.detail).toBe(detail);
    }
  });

  it('nennt als Hinweis die Zeichencodes der ersten drei Fremdzeichen, nie den Text', () => {
    const result = parseDocumentSpec(doc({ parts: [{ type: 'paragraph', text: 'Δ ⇌ ∑ Δ' }] }));
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'unsupported_text', detail: 'U+0394, U+21CC, U+2211' },
    });
  });

  it('macht geschützte Bindestriche zu normalen, die das PDF setzt', () => {
    const result = parseDocumentSpec(
      doc({ parts: [{ type: 'paragraph', text: 'd‑Orbital und s‐Block' }] }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { parts: [{ type: 'paragraph', text: 'd-Orbital und s-Block' }] },
    });
  });

  it('begrenzt die Anzahl der Abschnitte und die Größe', () => {
    const many = Array.from({ length: 61 }, () => ({ type: 'paragraph', text: 'x' }));
    expect(parseDocumentSpec(doc({ parts: many }))).toMatchObject({
      ok: false,
      error: { code: 'invalid_document', detail: 'parts' },
    });
    const big = doc({ title: 'x'.repeat(LIMITS.document) });
    expect(parseDocumentSpec(big)).toMatchObject({ ok: false, error: { code: 'too_large' } });
  });

  it('nennt im Hinweis nie Text aus der Eingabe', () => {
    const result = parseDocumentSpec(doc({ parts: [{ type: 'paragraph', text: 'geheim Δ' }] }));
    expect(JSON.stringify(result)).not.toMatch(/geheim/);
  });

  it('prüft ohne Befund, wenn alles in Ordnung ist', () => {
    expect(validateDocument(doc())).toBeNull();
    expect(validateDocument('{}')?.code).toBe('invalid_document');
  });
});

describe('Dokument im Text', () => {
  it('erkennt den Block als eigene Art', () => {
    expect(extractBlocks(`\`\`\`document\n${doc()}\n\`\`\``)).toEqual([
      expect.objectContaining({ kind: 'document', index: 1, source: doc() }),
    ]);
  });

  it('meldet fehlerhafte Dokument-Blöcke, gültige bleiben ohne Befund', async () => {
    expect(await validateMarkdown(`\`\`\`document\n${doc()}\n\`\`\``)).toEqual([]);
    const issues = await validateMarkdown(
      `\`\`\`document\n${doc({ parts: [{ type: 'paragraph', text: 'Δ H' }] })}\n\`\`\``,
    );
    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'document',
        index: 1,
        code: 'unsupported_text',
        detail: 'U+0394',
      }),
    ]);
  });
});
