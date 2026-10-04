/**
 * Mac wach halten. Der Mac ist der Server für iPhone und iPad: Schläft er, ist Pagewise dort nicht erreichbar.
 * Die App hält die Anwendung wach (`prevent-app-suspension`), das Display darf ausgehen.
 *
 * Regel: Solange Antworten laufen, ist es immer an (auch wenn der Schalter aus ist), sonst folgt es dem Schalter.
 *
 * Grenze, ehrlich: Bei **zugeklapptem Deckel ohne externes Display** schläft ein MacBook trotz dieser Zusicherung
 * („forced sleep“, laut Vorrecherche, am Gerät nicht geprüft). „Wake for network access“ und Power Nap helfen für
 * Tailscale nicht. Netzbetrieb und ein externes Display (oder offener Deckel) sind die verlässliche Wahl.
 */
export type WakeReason = 'user' | 'answers';

export function wakeReason(input: {
  userEnabled: boolean;
  activeChats: number;
}): WakeReason | null {
  if (input.activeChats > 0) return 'answers';
  return input.userEnabled ? 'user' : null;
}

export interface PowerSaveBlockerLike {
  start(type: 'prevent-app-suspension' | 'prevent-display-sleep'): number;
  stop(id: number): void;
  isStarted(id: number): boolean;
}

export class KeepAwake {
  private id: number | null = null;
  private current: WakeReason | null = null;

  constructor(private readonly blocker: PowerSaveBlockerLike) {}

  /** Setzt die Zusicherung nach der Regel. Gibt den Grund zurück, `null` heißt „darf schlafen“. */
  update(input: { userEnabled: boolean; activeChats: number }): WakeReason | null {
    const reason = wakeReason(input);
    this.current = reason;
    if (reason && (this.id === null || !this.blocker.isStarted(this.id))) {
      this.id = this.blocker.start('prevent-app-suspension');
    } else if (!reason && this.id !== null) {
      this.blocker.stop(this.id);
      this.id = null;
    }
    return reason;
  }

  get reason(): WakeReason | null {
    return this.current;
  }

  get active(): boolean {
    return this.id !== null && this.blocker.isStarted(this.id);
  }

  dispose(): void {
    if (this.id !== null) this.blocker.stop(this.id);
    this.id = null;
    this.current = null;
  }
}
