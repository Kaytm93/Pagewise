/*
 * Läuft vor dem ersten Anstrich und setzt Darstellung (hell/dunkel) und Effektstufe, damit beim Laden nichts
 * aufblitzt. Dieselben Schlüssel und Klassen wie ui/theme.ts und ui/fx.ts (ein Test vergleicht sie).
 * Inline-Skripte erlaubt die CSP nicht, deshalb liegt es als Datei bei.
 */
(() => {
  var root = document.documentElement;
  var store = {};
  var level;
  var reduced;
  try {
    store.theme = window.localStorage.getItem('pagewise.theme');
    store.fx = window.localStorage.getItem('pagewise.fx');
  } catch {
    // Ohne Speicher gelten die Voreinstellungen des Geräts.
  }
  if (store.theme === 'light' || store.theme === 'dark')
    root.setAttribute('data-theme', store.theme);
  level = store.fx;
  if (level !== 'full' && level !== 'reduced' && level !== 'off') {
    reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    level = reduced ? 'reduced' : 'full';
  }
  root.classList.add(`fx-${level}`);
})();
