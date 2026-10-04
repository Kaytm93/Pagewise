// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyFx, initFx, readFx, resolveFx, saveFx } from './fx';

function mockMedia(reduced: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: reduced,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    set(value: boolean) {
      query.matches = value;
      for (const listener of listeners) listener();
    },
    count: () => listeners.size,
  };
}

const classes = () =>
  [...document.documentElement.classList].filter((name) => name.startsWith('fx-'));

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('Effektstufen', () => {
  it.each([
    ['system', false, 'full'],
    ['system', true, 'reduced'],
    ['full', true, 'full'],
    ['reduced', false, 'reduced'],
    ['off', false, 'off'],
  ] as const)('Wahl %s bei reduzierter Bewegung %s ergibt %s', (preference, reduced, level) => {
    expect(resolveFx(preference, reduced)).toBe(level);
  });

  it('liest nur bekannte gespeicherte Werte und fällt sonst auf „system“ zurück', () => {
    expect(readFx()).toBe('system');
    window.localStorage.setItem('pagewise.fx', 'off');
    expect(readFx()).toBe('off');
    window.localStorage.setItem('pagewise.fx', 'wild');
    expect(readFx()).toBe('system');
  });

  it('setzt genau eine Klasse und speichert die Wahl; „system“ löscht sie', () => {
    mockMedia(false);
    saveFx('off');
    expect(classes()).toEqual(['fx-off']);
    expect(window.localStorage.getItem('pagewise.fx')).toBe('off');
    saveFx('full');
    expect(classes()).toEqual(['fx-full']);
    saveFx('system');
    expect(window.localStorage.getItem('pagewise.fx')).toBeNull();
    expect(classes()).toEqual(['fx-full']);
  });

  it('funktioniert ohne Speicher', () => {
    mockMedia(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('gesperrt');
    });
    expect(() => saveFx('reduced')).not.toThrow();
    expect(classes()).toEqual(['fx-reduced']);
    vi.restoreAllMocks();
  });

  it('folgt bei „system“ einer Änderung am Gerät, bei einer festen Wahl nicht', () => {
    const media = mockMedia(false);
    const stop = initFx();
    expect(classes()).toEqual(['fx-full']);
    media.set(true);
    expect(classes()).toEqual(['fx-reduced']);
    saveFx('full');
    media.set(false);
    media.set(true);
    expect(classes()).toEqual(['fx-full']);
    stop();
    expect(media.count()).toBe(0);
  });

  it('pausiert Dauerläufer, solange der Tab verborgen ist', () => {
    mockMedia(false);
    const stop = initFx();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.documentElement.classList.contains('tab-hidden')).toBe(true);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.documentElement.classList.contains('tab-hidden')).toBe(false);
    stop();
  });

  it('applyFx liefert die tatsächliche Stufe', () => {
    mockMedia(true);
    expect(applyFx('system')).toBe('reduced');
  });
});

describe('boot.js', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'boot.js'),
    'utf8',
  );

  it('nutzt dieselben Schlüssel und Klassen wie die Module', () => {
    expect(source).toContain("'pagewise.fx'");
    expect(source).toContain("'pagewise.theme'");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: gesucht wird der Quelltext des Skripts
    expect(source).toContain('fx-${level}');
    for (const level of ['full', 'reduced', 'off']) expect(source).toContain(`'${level}'`);
  });

  it('setzt die Stufe vor dem ersten Anstrich wie fx.ts', () => {
    window.localStorage.setItem('pagewise.fx', 'off');
    window.localStorage.setItem('pagewise.theme', 'dark');
    // eslint-disable-next-line no-new-func
    new Function(source)();
    expect(classes()).toEqual(['fx-off']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
