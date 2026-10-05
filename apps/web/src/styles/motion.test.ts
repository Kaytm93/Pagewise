import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Der Formatter darf Anführungszeichen im CSS ändern, daher vereinheitlichen; Zeilenumbrüche
// werden eingeebnet, damit Selektorlisten über mehrere Zeilen hinweg einfach durchsucht werden.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'motion.css'), 'utf8')
  .replaceAll('"', "'")
  .replaceAll(/\s+/g, ' ');

/** Text der ersten Regel ab `selector` bis zur schließenden Klammer. */
function ruleBody(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Regel fehlt in motion.css: ${selector}`);
  return css.slice(start, css.indexOf('}', start) + 1);
}

// Der pulsierende Wartepunkt (chat-flow#13) ist ein Dauerläufer: Er muss schon bei der Stufe
// „Reduziert“ (fx-reduced) stehen bleiben, nicht erst bei „Aus“ (fx-off).
describe('Pulsierender Wartepunkt (.animate-pulse)', () => {
  it('steht bei „Reduziert“ (:root.fx-reduced) still', () => {
    expect(ruleBody(':root.fx-reduced .animate-pulse')).toContain('animation: none');
  });

  it('steht bei „Aus“ (:root.fx-off) still', () => {
    expect(ruleBody(':root.fx-off .animate-pulse')).toContain('animation: none');
  });
});
