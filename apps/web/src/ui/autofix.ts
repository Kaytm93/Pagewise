/**
 * „Fehlerhafte Blöcke automatisch korrigieren lassen“ (Hefteinträge, Phase 1b): Lässt sich ein Block einer
 * Antwort nicht zeichnen, geht einmal eine Korrekturanfrage mit den Fehlercodes an das Modell. Standard: an.
 * Gilt nur in diesem Browser (wie Darstellung und Bewegung) und verlässt das Gerät nicht.
 */
const KEY = 'pagewise.autofix';

export function readAutoFix(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveAutoFix(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, 'off');
  } catch {
    // Die Wahl gilt dann nur bis zum Neuladen.
  }
}
