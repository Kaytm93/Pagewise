/**
 * Start bei Anmeldung. Electron 44 nutzt auf macOS 13 und neuer den Systemdienst für Anmeldeobjekte:
 * `setLoginItemSettings({ openAtLogin })` ohne Argumente (`args` und `openAsHidden` gibt es dort nicht mehr).
 * „Versteckt starten“ erkennt die App deshalb an `wasOpenedAtLogin`. Der Status kann `requires-approval` sein,
 * dann muss die Person Pagewise in den Systemeinstellungen unter „Allgemein → Anmeldeobjekte“ freigeben.
 * Quelle: Typen von Electron 44.5.1 (`electron.d.ts`, `LoginItemSettings`), gelesen am 4. Oktober 2026.
 */
export interface LoginItemApi {
  getLoginItemSettings(): {
    openAtLogin: boolean;
    wasOpenedAtLogin?: boolean;
    status?: 'not-registered' | 'enabled' | 'requires-approval' | 'not-found';
  };
  setLoginItemSettings(settings: { openAtLogin: boolean }): void;
}

export interface LoginItemState {
  /** Nur auf macOS (die Hülle ist dafür gebaut). */
  supported: boolean;
  /** Die Person hat es eingeschaltet (auch wenn macOS noch die Freigabe verlangt). */
  enabled: boolean;
  needsApproval: boolean;
  /** Die App wurde von macOS bei der Anmeldung gestartet. */
  wasOpenedAtLogin: boolean;
}

export function readLoginItem(api: LoginItemApi, platform: NodeJS.Platform): LoginItemState {
  if (platform !== 'darwin') {
    return { supported: false, enabled: false, needsApproval: false, wasOpenedAtLogin: false };
  }
  const settings = api.getLoginItemSettings();
  const needsApproval = settings.status === 'requires-approval';
  return {
    supported: true,
    enabled: settings.openAtLogin || needsApproval || settings.status === 'enabled',
    needsApproval,
    wasOpenedAtLogin: settings.wasOpenedAtLogin === true,
  };
}

export function setOpenAtLogin(
  api: LoginItemApi,
  enabled: boolean,
  platform: NodeJS.Platform,
): LoginItemState {
  if (platform === 'darwin') api.setLoginItemSettings({ openAtLogin: enabled });
  return readLoginItem(api, platform);
}

/** Beim Start durch die Anmeldung bleibt das Fenster zu: Der Server läuft, das Menüleisten-Symbol ist da. */
export function shouldStartHidden(state: LoginItemState, argv: readonly string[]): boolean {
  return state.wasOpenedAtLogin || argv.includes('--hidden');
}
