/**
 * Was ein Agent während einer Antwort getan hat: Werkzeug und Ziel (Datei oder Anfang des Befehls), nie
 * Inhalte. Wird live angezeigt und mit der Nachricht gespeichert, damit die Person nachvollziehen kann, was
 * passiert ist.
 */
export interface ActivityEntry {
  id: string;
  tool: string;
  target: string | null;
  state: 'running' | 'done' | 'error';
}

export const MAX_ACTIVITY = 60;
const STATES = new Set<ActivityEntry['state']>(['running', 'done', 'error']);

/** Fügt einen Eintrag ein oder aktualisiert den mit gleicher ID. Mehr als `MAX_ACTIVITY` werden nicht gemerkt. */
export function upsertActivity(list: ActivityEntry[], entry: ActivityEntry): ActivityEntry[] {
  const index = list.findIndex((item) => item.id === entry.id);
  if (index !== -1) {
    const next = [...list];
    next[index] = entry;
    return next;
  }
  return list.length >= MAX_ACTIVITY ? list : [...list, entry];
}

/** Was nach dem Ende noch „läuft“, ist abgebrochen: als Fehler zählen (bei Abbruch) oder als erledigt. */
export function settleActivity(list: ActivityEntry[], aborted: boolean): ActivityEntry[] {
  return list.map((entry) =>
    entry.state === 'running' ? { ...entry, state: aborted ? 'error' : 'done' } : entry,
  );
}

export function serializeActivity(list: ActivityEntry[]): string | null {
  return list.length === 0 ? null : JSON.stringify(list.map(({ id: _id, ...rest }) => rest));
}

/** Liest gespeicherte Einträge. Was nicht passt, wird übersprungen (die Datenbank ist nicht vertrauenswürdig genug für `as`). */
export function parseActivity(json: string | null): ActivityEntry[] {
  if (!json) return [];
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const list: ActivityEntry[] = [];
  for (const [index, item] of value.entries()) {
    if (list.length >= MAX_ACTIVITY) break;
    if (typeof item !== 'object' || item === null) continue;
    const { tool, target, state } = item as Record<string, unknown>;
    if (typeof tool !== 'string' || !STATES.has(state as ActivityEntry['state'])) continue;
    list.push({
      id: String(index),
      tool: tool.slice(0, 40),
      target: typeof target === 'string' ? target.slice(0, 120) : null,
      state: state as ActivityEntry['state'],
    });
  }
  return list;
}
