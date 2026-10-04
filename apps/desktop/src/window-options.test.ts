import { describe, expect, it } from 'vitest';
import {
  buildShellWindowOptions,
  buildWindowOptions,
  DEFAULT_BOUNDS,
  MIN_SIZE,
  securePreferences,
} from './window-options';

describe('Fensteroptionen (Sicherheit festgenagelt)', () => {
  it('Sicherheitsoptionen nach der Electron-Checkliste, genau diese und keine mehr', () => {
    expect(securePreferences('darwin')).toEqual({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      experimentalFeatures: false,
      safeDialogs: true,
      navigateOnDragDrop: false,
      spellcheck: true,
    });
  });

  it('schaltet nur die Rechtschreibung nach Plattform um (außerhalb des Macs würde Chromium ein Wörterbuch laden)', () => {
    const mac = securePreferences('darwin');
    const linux = securePreferences('linux');
    expect(mac.spellcheck).toBe(true);
    expect(linux.spellcheck).toBe(false);
    expect({ ...linux, spellcheck: true }).toEqual(mac);
  });

  it('das Hauptfenster bekommt genau diese Optionen und keinen Preload', () => {
    const options = buildWindowOptions({ platform: 'darwin' });
    expect(options.webPreferences).toEqual(securePreferences('darwin'));
    expect(options.webPreferences).not.toHaveProperty('preload');
    expect(options.show).toBe(false);
    expect(options.title).toBe('Pagewise');
  });

  it('lockert auch durch Eingaben keine Sicherheitsoption', () => {
    const options = buildWindowOptions({
      bounds: { x: 10, y: 20, width: 1000, height: 700 },
      dark: true,
    });
    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.sandbox).toBe(true);
    expect(options.webPreferences?.nodeIntegration).toBe(false);
    expect(options.webPreferences?.webSecurity).toBe(true);
  });

  it('übernimmt Lage und Größe, nie unter der Mindestgröße', () => {
    expect(buildWindowOptions()).toMatchObject(DEFAULT_BOUNDS);
    expect(
      buildWindowOptions({ bounds: { x: 10, y: 20, width: 1000, height: 700 } }),
    ).toMatchObject({
      x: 10,
      y: 20,
      width: 1000,
      height: 700,
    });
    const small = buildWindowOptions({ bounds: { width: 100, height: 100 } });
    expect(small).toMatchObject({ width: MIN_SIZE.width, height: MIN_SIZE.height });
    expect(small).not.toHaveProperty('x');
    expect(buildWindowOptions({ bounds: { x: 5, width: 900, height: 700 } })).not.toHaveProperty(
      'x',
    );
  });

  it('wählt die Hintergrundfarbe nach hell und dunkel (kein Aufblitzen beim Start)', () => {
    expect(buildWindowOptions().backgroundColor).toBe('#fdfcfb');
    expect(buildWindowOptions({ dark: true }).backgroundColor).toBe('#191918');
  });

  it('Hüllen-Fenster: gleiche Sicherheit, eigener Preload, nie Remote-Inhalt vorgesehen', () => {
    const options = buildShellWindowOptions({
      preload: '/App/preload.cjs',
      title: 'Verbinden',
      platform: 'darwin',
    });
    expect(options.webPreferences).toEqual({
      ...securePreferences('darwin'),
      preload: '/App/preload.cjs',
    });
    expect(options.title).toBe('Verbinden');
    expect(options.show).toBe(false);
  });
});
