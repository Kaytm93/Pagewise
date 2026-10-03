import { de, type Messages } from './de';

/** Aktive Texte. Eine Sprachauswahl folgt mit den Einstellungen. */
export const messages: Messages = de;

/** Ersetzt {name}-Platzhalter in einem Text. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Wartezeit als Text: „eine Minute“, „5 Minuten“. Rundet auf volle Minuten auf. */
export function formatWait(seconds: number): string {
  const m = messages.duration;
  if (seconds <= 0) return m.lessThanMinute;
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? m.oneMinute : format(m.minutes, { count: minutes });
}
