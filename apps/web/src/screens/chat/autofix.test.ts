// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { autoFixRequest } from './autofix';

describe('Korrekturanfrage', () => {
  it('nennt das Fremdzeichen als Zeichencode, nie den Text aus dem Block', async () => {
    const block = JSON.stringify({
      title: 'Formel',
      parts: [{ type: 'paragraph', text: 'geheim Δ H' }],
    });
    const request = await autoFixRequest(`\`\`\`document\n${block}\n\`\`\``);
    expect(request).toContain('(unsupported_text: U+0394)');
    expect(request).not.toContain('geheim');
  });

  it('gibt nichts zurück, wenn alle Blöcke zu zeichnen sind', async () => {
    expect(await autoFixRequest('Ein Satz ohne Block.')).toBeNull();
  });
});
