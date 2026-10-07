/*
 * Läuft vor dem ersten Anstrich und setzt Darstellung (hell/dunkel), Designrichtung und Effektstufe, damit beim
 * Laden nichts aufblitzt. Dieselben Schlüssel und Klassen wie ui/theme.ts, ui/design.ts und ui/fx.ts (ein
 * Test vergleicht sie). Inline-Skripte erlaubt die CSP nicht, deshalb liegt es als Datei bei.
 */
(() => {
  var root = document.documentElement;
  var store = {};
  var level;
  var reduced;
  var design;
  var colors = { light: '#fdfcfb', dark: '#191918' };
  try {
    store.theme = window.localStorage.getItem('pagewise.theme');
    store.fx = window.localStorage.getItem('pagewise.fx');
    store.design = window.localStorage.getItem('pagewise.design');
  } catch {
    // Ohne Speicher gelten die Voreinstellungen des Geräts.
  }
  if (store.theme === 'light' || store.theme === 'dark')
    root.setAttribute('data-theme', store.theme);
  var theme =
    store.theme === 'light' || store.theme === 'dark'
      ? store.theme
      : typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  var meta = root.parentNode.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute('content', colors[theme]);
  design = store.design;
  if (design !== 'raum' && design !== 'lagen' && design !== 'atelier') design = 'raum';
  root.setAttribute('data-design', design);
  level = store.fx;
  if (level !== 'full' && level !== 'reduced' && level !== 'off') {
    reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    level = reduced ? 'reduced' : 'full';
  }
  root.classList.add(`fx-${level}`);
})();
