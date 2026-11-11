import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * „Zum Ende“-Knopf (F-082, D-118): Lage, Größe und Übergänge liegen in `styles/screens.css`, der Einbau in
 * `ChatPage.tsx`. jsdom misst kein Layout und kennt kein CSS, darum Strukturtest am Quelltext; die Maße kommen aus
 * der Browsermessung (`pw/agents/S-04b/`, Belege `shots/S-04b/`).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

/** Der Rumpf der ersten Regel mit genau diesem Selektor (ohne verschachtelte Blöcke). */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `Regel ${selector} fehlt`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('ScrollToEnd: Einbau im Chat', () => {
  const chat = read('screens/chat/ChatPage.tsx');

  it('sitzt im klebenden Eingabebereich, vor der Spalte mit dem Eingabefeld', () => {
    const dock = chat.indexOf('sticky bottom-[var(--kb,0px)]');
    const button = chat.indexOf('<ScrollToEnd');
    const composer = chat.indexOf('<Composer');
    expect(dock).toBeGreaterThan(0);
    expect(button).toBeGreaterThan(dock);
    expect(composer).toBeGreaterThan(button);
  });

  it('nimmt den Zustand aus dem Hook und nicht aus einem eigenen Scroll-Beobachter', () => {
    expect(chat).toContain('const { follow, pin, toEnd, away, watch } = useFollowEnd()');
    expect(chat).toContain('visible={away}');
  });

  it('der Text steht in i18n/de.ts, nicht im Baustein', () => {
    expect(read('i18n/de.ts')).toContain("toEnd: 'Zum Ende des Chats'");
    const baustein = read('screens/chat/ScrollToEnd.tsx').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(baustein).not.toContain('Zum Ende');
    expect(baustein).toContain('m.chat.toEnd');
  });

  it('kein Inline-Stil in Baustein, Hook und ChatPage', () => {
    for (const file of ['ScrollToEnd.tsx', 'useFollowEnd.ts', 'ChatPage.tsx']) {
      expect(read(`screens/chat/${file}`), file).not.toMatch(/\bstyle=\{/);
    }
  });
});

describe('ScrollToEnd: Lage, Größe und Übergänge in screens.css', () => {
  const css = read('styles/screens.css');
  const shell = rule(css, '.lg-toend');
  const hidden = rule(css, '.lg-toend[data-visible="false"]');

  it('liegt absolut über der Oberkante des Eingabebereichs, 44 px groß, mit Abstand', () => {
    expect(shell).toContain('position: absolute');
    expect(shell).toContain('bottom: 100%');
    expect(shell).toContain('width: 2.75rem');
    expect(shell).toContain('height: 2.75rem');
    expect(shell).toMatch(/margin-bottom:\s*0\.75rem/);
  });

  it('schließt rechts mit der Eingabespalte ab (700 px, mittig; Rand 16 px, ab 640 px 32 px)', () => {
    expect(shell).toContain('right: max(1rem, calc((100% - 700px) / 2))');
    expect(css).toMatch(
      /@media \(min-width: 40rem\) \{\s*\.lg-toend \{\s*right: max\(2rem, calc\(\(100% - 700px\) \/ 2\)\);/,
    );
    const chat = read('screens/chat/ChatPage.tsx');
    expect(chat).toContain('sm:px-8');
    expect(chat).toContain('max-w-[700px]');
  });

  it('bewegt nur opacity und transform, Dauer aus --m und --t-fast (0 ms bei Reduziert und Aus)', () => {
    expect(shell).toContain('--toend-t: calc(var(--m) * var(--t-fast))');
    expect(shell).toContain('opacity var(--toend-t)');
    expect(shell).toContain('transform var(--toend-t)');
    expect(shell).not.toMatch(/transition:\s*all/);
    expect(shell).not.toMatch(/\b(top|left|width|height|margin|inset)\s+var\(--toend-t\)/);
  });

  it('verborgen: durchsichtig, nur über --m verschoben, erst nach dem Ausblenden unsichtbar, nicht klickbar', () => {
    expect(hidden).toContain('opacity: 0');
    expect(hidden).toContain('transform: translateY(calc(var(--m) * 8px))');
    expect(hidden).toContain('visibility: hidden');
    expect(hidden).toContain('pointer-events: none');
    expect(hidden).toContain('visibility 0s linear var(--toend-t)');
  });

  it('Hover nur mit Maus, ohne feste Farben: Grundgestalt aus Tokens', () => {
    expect(css).toMatch(
      /@media \(hover: hover\) \{\s*\.lg-toend-button:hover \{\s*background-color: var\(--paper\);/,
    );
    const button = rule(css, '.lg-toend-button');
    for (const token of ['--control-edge', '--toend-surface', '--ink', '--shadow']) {
      expect(button).toContain(`var(${token}`);
    }
    expect(button).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(rule(css, '.lg-toend-button[data-writing]::after')).toContain(
      'var(--subj, var(--accent))',
    );
  });
});
