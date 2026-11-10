import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Höhe des Eingabefelds im Chat (F-017, D-115): Die Obergrenze war fest 12 rem. Im Querformat mit Tastatur
 * (sichtbar etwa 190 px) wurde die Eingabezeile 244 bis 283 px hoch, das Feld ragte über den oberen Rand.
 * Jetzt gilt `--composer-max` (12 rem, höchstens 40 % des sichtbaren Bereichs, also Fensterhöhe minus
 * Tastatur `--kb`) in allen drei Richtungen. jsdom misst kein Layout, darum Strukturtest am Quelltext; die
 * Maße kommen aus der Browsermessung (pw/agents/S-04/f017.mjs).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

describe('Eingabefeld im Chat: Obergrenze an den sichtbaren Bereich gekoppelt (F-017)', () => {
  const screens = read('styles/screens.css');
  const token = /--composer-max:\s*([^;]+);/.exec(screens)?.[1] ?? '';

  it('--composer-max: höchstens 12 rem und höchstens 40 % von Fensterhöhe minus Tastatur', () => {
    expect(token).toContain('min(12rem');
    expect(token).toContain('100dvh');
    expect(token).toContain('var(--kb');
    expect(token).toContain('0.4');
  });

  it('Raum und Atelier: das Feld nimmt die Grenze aus dem Token, nicht mehr max-h-48', () => {
    const composer = read('screens/chat/Composer.tsx');
    expect(composer).toContain('max-h-[var(--composer-max)]');
    expect(composer).not.toContain('max-h-48');
  });

  it('Lagen: .lg-composer-input nimmt die Grenze aus dem Token, nicht mehr 12rem', () => {
    const lagen = read('styles/lagen.css');
    const rule = /\.lg-composer-input\s*\{[^}]*\}/.exec(lagen)?.[0] ?? '';
    expect(rule).toContain('max-height: var(--composer-max)');
    expect(rule).not.toContain('12rem');
  });
});
