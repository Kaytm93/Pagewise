export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'pagewise.theme';

/**
 * Schreibtischfarbe je Darstellung — dieselben Werte wie die theme-color-Metas in index.html und das
 * Manifest (pwa-files.test.ts vergleicht sie). Die Flächen des Schreibtischs sind in allen Richtungen
 * gleich (raum.css färbt nur den eigenen Verlauf um), darum genügen die Canvas-Werte.
 */
export const THEME_COLORS = { light: '#fdfcfb', dark: '#191918' } as const;

/**
 * Wirksame Darstellung: die gespeicherte Wahl oder, bei „system“, die des Geräts. Genau die Logik, mit
 * der tokens.css die Tokens umschaltet ([data-theme] schlägt prefers-color-scheme).
 */
export function effectiveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference;
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** Setzt die Rahmen-/Statusleistenfarbe (meta name=theme-color) auf die Fläche der Oberfläche. */
export function applyThemeColor(preference: ThemePreference): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  meta?.setAttribute('content', THEME_COLORS[effectiveTheme(preference)]);
}

/** Gespeicherte Wahl. Ohne Speicher (privates Fenster, gesperrt) folgt die Oberfläche dem System. */
export function readTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
  applyThemeColor(preference);
}

/** Folgt bei „system“ einer Änderung am Gerät, solange keine feste Wahl gespeichert ist. */
export function initTheme(): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (readTheme() === 'system') applyThemeColor('system');
  };
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function saveTheme(preference: ThemePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, preference);
  } catch {
    // Die Wahl gilt dann nur bis zum Neuladen.
  }
  applyTheme(preference);
}
