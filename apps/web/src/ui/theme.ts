export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'pagewise.theme';

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
