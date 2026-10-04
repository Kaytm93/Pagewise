import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  fitBounds,
  parseSettings,
  SettingsStore,
  ZOOM_MAX,
  ZOOM_MIN,
} from './settings-store';

describe('Einstellungen der Hülle', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pagewise-desktop-'));
    file = join(dir, 'desktop-settings.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('beginnt mit den Voreinstellungen (Wachhalten an)', () => {
    expect(new SettingsStore(file).read()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.keepAwake).toBe(true);
  });

  it('speichert, liest wieder und legt die Datei nur für den Besitzer an', () => {
    const store = new SettingsStore(file);
    store.update({
      windowBounds: { x: 10, y: 20, width: 1100, height: 800 },
      zoomLevel: 1,
      keepAwake: false,
    });
    expect(new SettingsStore(file).read()).toEqual({
      windowBounds: { x: 10, y: 20, width: 1100, height: 800 },
      zoomLevel: 1,
      keepAwake: false,
      tailscaleServe: false,
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8').endsWith('\n')).toBe(true);
  });

  it('fällt bei kaputter oder fremder Datei auf die Voreinstellung zurück', () => {
    writeFileSync(file, 'kein json');
    expect(new SettingsStore(file).read()).toEqual(DEFAULT_SETTINGS);
    writeFileSync(file, JSON.stringify([1, 2, 3]));
    expect(new SettingsStore(file).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('prüft jeden Wert und verwirft Ungültiges', () => {
    expect(
      parseSettings({
        windowBounds: { x: 'a', y: 1, width: 900, height: 700 },
        zoomLevel: 99,
        keepAwake: 'ja',
        fremd: 'wird ignoriert',
      }),
    ).toEqual({
      windowBounds: { width: 900, height: 700 },
      zoomLevel: ZOOM_MAX,
      keepAwake: true,
      tailscaleServe: false,
    });
    expect(parseSettings({ zoomLevel: -99 }).zoomLevel).toBe(ZOOM_MIN);
    expect(parseSettings({ zoomLevel: Number.NaN }).zoomLevel).toBe(0);
    expect(parseSettings({ zoomLevel: 0.26 }).zoomLevel).toBe(0.5);
    for (const bad of [
      { width: 10, height: 10 },
      { width: 1e9, height: 700 },
      { width: Number.POSITIVE_INFINITY, height: 700 },
      { width: '900', height: 700 },
      null,
      'x',
    ]) {
      expect(parseSettings({ windowBounds: bad }).windowBounds, JSON.stringify(bad)).toBeNull();
    }
  });

  it('schreibt nichts Unbekanntes in die Datei', () => {
    const store = new SettingsStore(file);
    store.update({ keepAwake: false, ...({ geheim: 'x' } as object) });
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8'))).sort()).toEqual([
      'keepAwake',
      'tailscaleServe',
      'windowBounds',
      'zoomLevel',
    ]);
  });

  it('übersteht einen nicht beschreibbaren Ort', () => {
    const store = new SettingsStore(join(file, 'unter', 'einer', 'datei'));
    writeFileSync(file, '{}');
    expect(() => store.update({ keepAwake: false })).not.toThrow();
    expect(store.read().keepAwake).toBe(false);
  });
});

describe('Fensterlage auf vorhandenen Bildschirmen', () => {
  const screens = [{ x: 0, y: 0, width: 1440, height: 900 }];
  it('behält eine sichtbare Lage', () => {
    const bounds = { x: 100, y: 80, width: 1000, height: 700 };
    expect(fitBounds(bounds, screens)).toEqual(bounds);
  });
  it('lässt die Position weg, wenn der Bildschirm fehlt (zweiter Monitor abgesteckt)', () => {
    expect(fitBounds({ x: 3000, y: 100, width: 1000, height: 700 }, screens)).toEqual({
      width: 1000,
      height: 700,
    });
    expect(fitBounds({ x: 100, y: 5000, width: 1000, height: 700 }, screens)).toEqual({
      width: 1000,
      height: 700,
    });
  });
  it('gibt null und Größen ohne Position unverändert zurück', () => {
    expect(fitBounds(null, screens)).toBeNull();
    expect(fitBounds({ width: 900, height: 700 }, screens)).toEqual({ width: 900, height: 700 });
  });
});
