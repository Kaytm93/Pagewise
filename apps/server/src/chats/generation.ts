import type { ProviderErrorCode } from '../providers/errors';

/** Fehlercodes einer Antwort: die der Anbieter plus drei, die Pagewise selbst kennt. */
export type ChatErrorCode = ProviderErrorCode | 'no_model' | 'empty_response' | 'internal';

export type MessageStatus = 'complete' | 'streaming' | 'stopped' | 'error' | 'interrupted';

export interface MessageView {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  providerId: string | null;
  model: string | null;
  errorCode: ChatErrorCode | null;
  createdAt: number;
}

/** Ereignisse einer laufenden Antwort. Die drei letzten beenden sie. */
export type GenerationEvent =
  | { type: 'model'; providerId: string; model: string }
  | { type: 'thinking' }
  | { type: 'delta'; text: string }
  | { type: 'done'; message: MessageView }
  | { type: 'failed'; code: ChatErrorCode; message: MessageView }
  | { type: 'stopped'; message: MessageView };

export type Listener = (event: GenerationEvent) => void;

export interface Snapshot {
  text: string;
  model: { providerId: string; model: string } | null;
  thinking: boolean;
  /** Das Ende, falls die Antwort schon fertig ist. */
  ended: GenerationEvent | null;
}

/**
 * Eine laufende Antwort. Sie hängt nicht an einer Verbindung: Wer zuhört, kann gehen und später
 * wiederkommen (`snapshot`), die Antwort läuft weiter und wird am Ende gespeichert. Nur `abort`
 * beendet sie vorzeitig.
 */
export class Generation {
  readonly abort = new AbortController();
  private readonly listeners = new Set<Listener>();
  private accumulated = '';
  private currentModel: { providerId: string; model: string } | null = null;
  private thinkingSeen = false;
  private ended: GenerationEvent | null = null;

  constructor(
    readonly chatId: string,
    readonly assistantId: string,
  ) {}

  get text(): string {
    return this.accumulated;
  }

  get model(): { providerId: string; model: string } | null {
    return this.currentModel;
  }

  get thinking(): boolean {
    return this.thinkingSeen;
  }

  get finished(): boolean {
    return this.ended !== null;
  }

  /**
   * Meldet einen Zuhörer an und liefert im selben Schritt den bisherigen Stand, damit nichts doppelt
   * oder gar nicht ankommt. Ist die Antwort schon zu Ende, steht ihr Ende im Stand und der Zuhörer
   * wird nicht mehr gebraucht. `unsubscribe` meldet ihn ab; die Antwort läuft danach weiter.
   */
  attach(listener: Listener): { snapshot: Snapshot; unsubscribe: () => void } {
    const snapshot: Snapshot = {
      text: this.accumulated,
      model: this.currentModel,
      thinking: this.thinkingSeen,
      ended: this.ended,
    };
    if (this.ended) return { snapshot, unsubscribe: () => {} };
    this.listeners.add(listener);
    return {
      snapshot,
      unsubscribe: () => {
        this.listeners.delete(listener);
      },
    };
  }

  emit(event: GenerationEvent): void {
    if (this.ended) return;
    if (event.type === 'delta') this.accumulated += event.text;
    else if (event.type === 'model') {
      this.currentModel = { providerId: event.providerId, model: event.model };
      this.thinkingSeen = false;
    } else if (event.type === 'thinking') {
      if (this.thinkingSeen) return;
      this.thinkingSeen = true;
    } else this.ended = event;

    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // Ein Zuhörer mit Fehler (z. B. getrennte Verbindung) darf die Antwort nicht stören.
        this.listeners.delete(listener);
      }
    }
    if (this.ended) this.listeners.clear();
  }
}
