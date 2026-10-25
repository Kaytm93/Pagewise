import type { ChatMessage } from '../../api/types';
import { messages as m } from '../../i18n';
import { SubjectMotifs } from './SubjectMotifs';

/*
 * Chat in der Richtung „Atelier“: das Randmotiv des Fachs und die Statuszeile im Kopf. Beides ist Zier bzw.
 * eine Wiederholung dessen, was die Live-Region der Chatansicht ohnehin ansagt. Der Lesebereich bleibt ruhig:
 * das Motiv liegt nur in den Rändern neben der Lesespalte und erst bei breiten Fenstern (`atelier-fach.css`).
 */

/** Der Zustand der Antwort, wie ihn die Statuszeile nennt. */
export type ChatPhase = 'thinking' | 'writing' | 'done' | 'ready' | 'stopped' | 'failed';

/**
 * Aus dem, was die Chatansicht weiß, den Zustand ableiten: läuft eine Antwort (zuerst „denkt“, dann
 * „schreibt“), sonst nach der letzten Nachricht („fertig“, „angehalten“, „fehlgeschlagen“, ohne Antwort „bereit“).
 */
export function chatPhase({
  running,
  thinking,
  last,
}: {
  running: boolean;
  thinking: boolean;
  last: ChatMessage | undefined;
}): ChatPhase {
  if (running) return thinking ? 'thinking' : 'writing';
  if (last?.role !== 'assistant') return 'ready';
  if (last.status === 'error') return 'failed';
  if (last.status === 'stopped' || last.status === 'interrupted') return 'stopped';
  return last.status === 'complete' ? 'done' : 'ready';
}

/** Statuszeile neben dem Modell: Punkt in der Fachfarbe und ein Wort. Der Punkt atmet nur, solange gearbeitet wird. */
export function ChatStatus({ phase }: { phase: ChatPhase }) {
  return (
    <p className="at-chat-status" data-state={phase}>
      <span aria-hidden="true" className="at-chat-dot" />
      {m.atelierFach.status[phase]}
    </p>
  );
}

/** Das Fachmotiv am rechten Rand, hinter keinem Text; ohne Fachsymbol (Standard) entfällt es. */
export function ChatEdgeMotif({ kind }: { kind: string | null }) {
  return (
    <div aria-hidden="true" className="at-chat-edge">
      <SubjectMotifs kind={kind} className="lg-motif at-chat-motif" />
    </div>
  );
}
