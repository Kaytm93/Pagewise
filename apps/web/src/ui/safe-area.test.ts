import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * iPhone quer (und iPad mit Rundungen) hat links oder rechts einen Rand, den Inhalt nicht überdecken darf.
 * Dieser Test sichert, dass die Rahmen der Ansichten die Randabstände von `env(safe-area-inset-*)` einrechnen,
 * und dass die Tastatur über `--kb` und nicht über Inline-Styles gelöst ist.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const FRAMES = [
  'shell/AppShell.tsx',
  'ui/modal.tsx',
  'screens/AuthLayout.tsx',
  'screens/onboarding/StepFrame.tsx',
  'connection/ConnectionBanner.tsx',
];

describe('Safe-Areas links und rechts', () => {
  for (const file of FRAMES) {
    it(`${file} rechnet beide Seiten ein`, () => {
      const source = read(file);
      expect(source).toContain('env(safe-area-inset-left)');
      expect(source).toContain('env(safe-area-inset-right)');
    });
  }

  it('rückt die Schublade (sie hängt links) um den linken Rand nach innen', () => {
    expect(read('shell/Drawer.tsx')).toContain('pl-[env(safe-area-inset-left)]');
  });

  it('lässt dem Inhalt der Shell links und rechts mindestens den Randabstand', () => {
    const shell = read('shell/AppShell.tsx');
    expect(shell).toContain('pl-[max(0.75rem,env(safe-area-inset-left))]');
    expect(shell).toContain('pr-[max(1.75rem,env(safe-area-inset-right))]');
    // Die Seitenleiste ab 768 px (iPhone quer) rutscht um den Rand nach innen.
    expect(shell).toContain('md:grid-cols-[calc(17.25rem+env(safe-area-inset-left))_1fr]');
  });
});

describe('Tastatur', () => {
  it('hebt Eingabezeile und Dialoge über --kb, nie über Inline-Styles', () => {
    expect(read('screens/chat/ChatPage.tsx')).toContain('sticky bottom-[var(--kb,0px)]');
    const modal = read('ui/modal.tsx');
    expect(modal).toContain('pb-[var(--kb,0px)]');
    expect(modal).toContain('max-h-[calc(92dvh-var(--kb,0px))]');
    expect(read('main.tsx')).toContain('startKeyboardInset()');
  });

  it('nutzt weder interactive-widget noch die VirtualKeyboard-API', () => {
    for (const file of [
      '../index.html',
      'ui/keyboard.ts',
      'main.tsx',
      'screens/chat/ChatPage.tsx',
    ]) {
      const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(source, file).not.toMatch(/interactive-widget|virtualKeyboard|VirtualKeyboard/);
    }
  });
});
