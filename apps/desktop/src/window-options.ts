import type { BrowserWindowConstructorOptions } from 'electron';
import { APP_NAME } from './config';

export interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export const DEFAULT_BOUNDS: Bounds = { width: 1280, height: 860 };
export const MIN_SIZE = { width: 800, height: 560 } as const;

/**
 * Sicherheitsoptionen aller Fenster dieser App (Electron-Sicherheits-Checkliste). Ein Test nagelt sie fest: Wer eine
 * davon lockert, muss den Test und D-050 anfassen. Das Fenster mit der Oberfläche bekommt keinen Preload, es gibt
 * keine Brücke in den Server-Inhalt.
 */
export function securePreferences(platform: NodeJS.Platform = process.platform) {
  return {
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
    // Nur auf dem Mac: Dort prüft macOS selbst. Anderswo lädt Chromium dafür ein Wörterbuch von Google (D-053).
    spellcheck: platform === 'darwin',
  } as const;
}

const BACKGROUND_LIGHT = '#fdfcfb';
const BACKGROUND_DARK = '#191918';

/** Hauptfenster: lädt die Oberfläche des Servers, ohne Preload und ohne Adressleiste. */
export function buildWindowOptions(
  input: { bounds?: Bounds | null; dark?: boolean; platform?: NodeJS.Platform } = {},
): BrowserWindowConstructorOptions {
  const bounds = input.bounds ?? DEFAULT_BOUNDS;
  return {
    ...(bounds.x !== undefined && bounds.y !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    width: Math.max(bounds.width, MIN_SIZE.width),
    height: Math.max(bounds.height, MIN_SIZE.height),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: APP_NAME,
    show: false,
    backgroundColor: input.dark ? BACKGROUND_DARK : BACKGROUND_LIGHT,
    webPreferences: { ...securePreferences(input.platform) },
  };
}

/** Kleines Hüllen-Fenster (z. B. „Mit iPhone und iPad verbinden“): lokale Datei, eigener Preload, eigene CSP. */
export function buildShellWindowOptions(input: {
  preload: string;
  title: string;
  dark?: boolean;
  platform?: NodeJS.Platform;
  parent?: BrowserWindowConstructorOptions['parent'];
}): BrowserWindowConstructorOptions {
  return {
    width: 560,
    height: 680,
    minWidth: 420,
    minHeight: 480,
    title: input.title,
    show: false,
    minimizable: false,
    fullscreenable: false,
    backgroundColor: input.dark ? BACKGROUND_DARK : BACKGROUND_LIGHT,
    ...(input.parent ? { parent: input.parent } : {}),
    webPreferences: { ...securePreferences(input.platform), preload: input.preload },
  };
}
