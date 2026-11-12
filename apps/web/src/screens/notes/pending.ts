/**
 * Ungesendete Hefteinträge (D-119). Scheitert das Abschicken beim Verlassen eines Eintrags (kein Netz,
 * Serverfehler), bleibt der eingegebene Stand hier, nur im Speicher der Seite (nie `localStorage`,
 * wie der Chat-Entwurf in D-028). Beim nächsten Öffnen desselben Eintrags kommt er zurück, steht als
 * „Nicht gespeichert“ da und wird erneut gesendet. Nach dem Neuladen der Seite ist er weg.
 */

/** Der Stand der vier Felder des Editors, so wie die Person ihn eingegeben hat. */
export interface NoteDraft {
  title: string;
  markdown: string;
  pinned: boolean;
  tagsText: string;
}

const pending = new Map<string, NoteDraft>();

/** Hält den Stand eines Eintrags fest, dessen Senden gescheitert ist (ersetzt einen früheren). */
export function rememberPending(noteId: string, draft: NoteDraft): void {
  pending.set(noteId, { ...draft });
}

/** Holt den festgehaltenen Stand eines Eintrags und vergisst ihn dabei. */
export function takePending(noteId: string): NoteDraft | undefined {
  const draft = pending.get(noteId);
  pending.delete(noteId);
  return draft;
}

/** Vergisst den Stand eines Eintrags (etwa nach dem Löschen). */
export function forgetPending(noteId: string): void {
  pending.delete(noteId);
}
