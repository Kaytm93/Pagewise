/**
 * Designrichtung (D-045): drei Gestaltungen derselben Oberfläche, wählbar wie hell und dunkel.
 *
 * - `raum`: ein Ordner mit Rücken und Heftung auf dem Schreibtisch, Tageslinie auf der Startseite.
 * - `lagen`: ein Heft mit Heftrücken und Blattstapel.
 * - `atelier`: klar und produktnah, große Typografie, Fachfarbe als Licht und Linie.
 *
 * Die Richtung steht als Attribut `data-design` am <html>; Tokens und Hülle hängen in den Dateien
 * `styles/raum.css`, `lagen.css` und `atelier.css` daran. `public/boot.js` setzt es vor dem ersten Anstrich,
 * dieses Modul übernimmt danach, auch bei einem Wechsel in den Einstellungen.
 */
export type Design = 'raum' | 'lagen' | 'atelier';

export const DESIGNS: readonly Design[] = ['raum', 'lagen', 'atelier'];
export const DEFAULT_DESIGN: Design = 'raum';

const KEY = 'pagewise.design';

function isDesign(value: string | null): value is Design {
  return value === 'raum' || value === 'lagen' || value === 'atelier';
}

/** Gespeicherte Wahl, sonst die Voreinstellung. Ohne Speicher (privates Fenster, gesperrt) gilt diese. */
export function readDesign(): Design {
  try {
    const value = window.localStorage.getItem(KEY);
    return isDesign(value) ? value : DEFAULT_DESIGN;
  } catch {
    return DEFAULT_DESIGN;
  }
}

/** Ereignis am Fenster, wenn sich die Richtung ändert (für `useDesign`). */
export const DESIGN_EVENT = 'pagewise:design';

export function applyDesign(design: Design): void {
  document.documentElement.setAttribute('data-design', design);
  window.dispatchEvent(new Event(DESIGN_EVENT));
}

export function saveDesign(design: Design): void {
  try {
    window.localStorage.setItem(KEY, design);
  } catch {
    // Die Wahl gilt dann nur bis zum Neuladen.
  }
  applyDesign(design);
}
