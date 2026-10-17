/**
 * Die Oberfläche läuft auch in der Mac-App (Electron). Nur dort gibt es den Knopf „Nach Updates suchen“ (D-057).
 * Er navigiert zu einer Adresse, die allein die Hülle der App versteht: Sie fängt die Navigation ab und öffnet das
 * Update-Fenster. In jedem anderen Browser (auch auf iPhone und iPad) erscheint der Knopf nicht.
 * Dieselbe Adresse steht in `apps/desktop/src/config.ts` (`UPDATE_PATH`); ein Test in der Hülle hält beide gleich.
 */
export const DESKTOP_UPDATE_PATH = '/__pagewise/update';

export function isDesktopApp(userAgent: string = navigator.userAgent): boolean {
  return /\bElectron\/\d/.test(userAgent);
}

export function openDesktopUpdate(): void {
  window.location.assign(DESKTOP_UPDATE_PATH);
}
