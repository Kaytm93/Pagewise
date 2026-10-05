import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * „Zum Inhalt springen“ (Anker #main) darf das Ziel nicht unter der festen Kopfzeile (h-14 = 56 px)
 * verstecken. scroll-mt-20 (5 rem) rückt das Sprungziel entsprechend nach unten; dieser Test liest den
 * Quelltext und nagelt fest, dass main#main die Klasse trägt.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Sprunglink-Ziel liegt nicht unter der Kopfzeile', () => {
  it('main#main trägt scroll-mt-20', () => {
    const shell = read('shell/AppShell.tsx');
    const main = shell.match(/<main[\s\S]*?<\/main>/);
    expect(main).not.toBeNull();
    expect(main?.[0]).toContain('id="main"');
    expect(main?.[0]).toContain('scroll-mt-20');
  });

  it('der Sprunglink zeigt weiterhin auf #main', () => {
    const shell = read('shell/AppShell.tsx');
    expect(shell).toContain('href="#main"');
  });
});
