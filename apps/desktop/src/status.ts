import type { WakeReason } from './keep-awake';
import type { LoginItemState } from './login-item';
import type { SupervisorSnapshot, SupervisorState } from './supervisor';

/**
 * Was die App über sich weiß. Der Stand läuft nur über IPC (Fenster der Hülle) und die Menüs, nie über HTTP: Hinter
 * Tailscale Serve ist ein „nur lokaler“ Endpunkt für das ganze Tailnet sichtbar (D-021, D-050).
 * Gezählt werden **Anmeldungen**, nicht Geräte: Die installierte iOS-App hat eigene Cookies, ein iPhone kann zwei haben.
 */
export interface DesktopStatus {
  server: {
    state: SupervisorState;
    port: number | null;
    /** Erste Zeile der Fehlermeldung (deutsch, ohne Secrets), `null` ohne Fehler. */
    failure: string | null;
    restarts: number;
  };
  /** Laufende Antworten, `null`, wenn der Server nicht antwortet. */
  runningAnswers: number | null;
  logins: number | null;
  setupPending: boolean | null;
  keepAwake: {
    /** Schalter des Menschen. */
    enabled: boolean;
    /** Ob die Zusicherung gerade gehalten wird, und warum. */
    active: boolean;
    reason: WakeReason | null;
  };
  loginItem: LoginItemState;
  /** Tailscale-Zustand und Adresse, wenn ermittelt (siehe `tailscale/`). */
  tailscale: { state: string; address: string | null } | null;
}

export interface StatusParts {
  server: SupervisorSnapshot;
  serverStatus: { activeChats: number; sessions: number; setupPending: boolean } | null;
  keepAwake: { enabled: boolean; active: boolean; reason: WakeReason | null };
  loginItem: LoginItemState;
  tailscale: { state: string; address: string | null } | null;
}

export function buildDesktopStatus(parts: StatusParts): DesktopStatus {
  return {
    server: {
      state: parts.server.state,
      port: parts.server.port,
      failure: parts.server.failure?.message.split('\n')[0] ?? null,
      restarts: parts.server.restarts,
    },
    runningAnswers: parts.serverStatus?.activeChats ?? null,
    logins: parts.serverStatus?.sessions ?? null,
    setupPending: parts.serverStatus?.setupPending ?? null,
    keepAwake: { ...parts.keepAwake },
    loginItem: { ...parts.loginItem },
    tailscale: parts.tailscale ? { ...parts.tailscale } : null,
  };
}
