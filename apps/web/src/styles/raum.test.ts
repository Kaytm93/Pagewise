import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Fensterlicht in „Raum“ (M4-T018): Das Lichtfeld (.lg-app::after) soll dem Zeiger folgen
 * und die Fachfarbe aufnehmen. Zwei Ursachen waren gemessen (~/pagewise-agent/befunde/static-css.json
 * #02/#03): Registrierte Variablen mit `inherits: false` vererben nicht ins Pseudo-Element,
 * und `--win` auf :root löste var(--subj) zum neutralen Ton der Wurzel auf, nicht zur Fachfarbe
 * auf .lg-app[data-subj]. Dieser Test nagelt die Struktur des Fixes fest; die Wirkung
 * (berechneter ::after-Stil ändert sich mit der Maus, Fachfarbe im Licht) ist im Echtbrowser
 * gemessen (Chromium und WebKit, siehe ~/pagewise-agent/logs/bericht-m4-t018.md).
 */

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, 'raum.css'), 'utf8')
  .replaceAll('"', "'")
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('raum.css: Fensterlicht folgt der Maus (M4-T018)', () => {
  it('registriert --px und --py mit inherits: true, damit .lg-app::after sie erbt', () => {
    for (const name of ['--px', '--py']) {
      const match = new RegExp(`@property\\s+${name}\\s*\\{([^}]*)\\}`).exec(css);
      expect(match, `@property ${name} fehlt`).not.toBeNull();
      expect(match?.[1]).toMatch(/inherits:\s*true\b/);
      expect(match?.[1]).toMatch(/initial-value:\s*0\b/);
    }
  });
});

describe('raum.css: Fensterlicht trägt die Fachfarbe (M4-T018)', () => {
  const winDeclaration = /--win:\s*color-mix\(in srgb, var\(--subj\) 12%, var\(--light\)\)/;

  it('definiert --win an .lg-app, nicht an der Wurzel', () => {
    // Block der Wurzel (erste :root[data-design='raum']-Regel): dort darf --win nicht mehr stehen,
    // denn var(--subj) würde dort zum neutralen Ton der Wurzel aufgelöst.
    const rootStart = css.indexOf(":root[data-design='raum'] {");
    expect(rootStart).toBeGreaterThanOrEqual(0);
    const rootEnd = css.indexOf('}', rootStart);
    const rootBlock = css.slice(rootStart, rootEnd);
    expect(rootBlock).not.toMatch(winDeclaration);

    // .lg-app-Regel mit der Definition (Muster: --glow in lagen.css).
    const appRule = /[^{}]*\.lg-app[^{}]*\{[^}]*\}/.exec(css);
    expect(appRule, 'keine .lg-app-Regel gefunden').not.toBeNull();
    expect(appRule?.[0]).toMatch(winDeclaration);
    expect(appRule?.[0]).toMatch(/:root\[data-design='raum'\]\s+\.lg-app/);
  });
});
