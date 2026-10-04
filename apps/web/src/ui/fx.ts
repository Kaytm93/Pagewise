/**
 * Effektstufen (D-043): wie viel sich in der Oberfläche bewegt.
 *
 * - `system`: folgt dem Gerät (`prefers-reduced-motion`), also „reduziert“ oder „voll“.
 * - `full`: Federn, gestaffeltes Einblenden, Blattwechsel.
 * - `reduced`: nur kurze Überblendungen, nichts verschiebt, dreht oder skaliert sich.
 * - `off`: keine Bewegung.
 *
 * Die Stufe steht als Klasse am <html> (`fx-full`, `fx-reduced`, `fx-off`), das Bewegungssystem
 * (`styles/motion.css`) hängt alles daran. Das Skript `public/boot.js` setzt sie vor dem ersten Anstrich
 * (damit nichts aufblitzt), dieses Modul übernimmt danach, auch bei einem Wechsel in den Einstellungen.
 */
export type FxPreference = 'system' | 'full' | 'reduced' | 'off';
export type FxLevel = 'full' | 'reduced' | 'off';

const KEY = 'pagewise.fx';
const LEVELS: readonly FxLevel[] = ['full', 'reduced', 'off'];

/** Gespeicherte Wahl. Ohne Speicher (privates Fenster, gesperrt) folgt die Oberfläche dem System. */
export function readFx(): FxPreference {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === 'full' || value === 'reduced' || value === 'off' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** Die tatsächliche Stufe: „system“ wird zu „reduziert“, wenn das Gerät es wünscht, sonst zu „voll“. */
export function resolveFx(preference: FxPreference, reduced = prefersReducedMotion()): FxLevel {
  if (preference !== 'system') return preference;
  return reduced ? 'reduced' : 'full';
}

export function applyFx(preference: FxPreference): FxLevel {
  const level = resolveFx(preference);
  const root = document.documentElement;
  for (const other of LEVELS) root.classList.toggle(`fx-${other}`, other === level);
  return level;
}

export function saveFx(preference: FxPreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, preference);
  } catch {
    // Die Wahl gilt dann nur bis zum Neuladen.
  }
  applyFx(preference);
}

/**
 * Setzt die Stufe, hält sie bei einem Wechsel der Systemeinstellung aktuell (nur bei „system“) und
 * pausiert Dauerläufer, solange der Tab nicht sichtbar ist. Gibt eine Funktion zum Aufräumen zurück.
 */
export function initFx(): () => void {
  applyFx(readFx());

  const query =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  const onSystem = () => {
    if (readFx() === 'system') applyFx('system');
  };
  query?.addEventListener('change', onSystem);

  const onVisibility = () => {
    document.documentElement.classList.toggle('tab-hidden', document.visibilityState === 'hidden');
  };
  document.addEventListener('visibilitychange', onVisibility);
  onVisibility();

  return () => {
    query?.removeEventListener('change', onSystem);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
