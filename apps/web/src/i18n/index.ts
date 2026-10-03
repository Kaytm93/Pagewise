import { de, type Messages } from './de';

/** Aktive Texte. Eine Sprachauswahl folgt mit den Einstellungen. */
export const messages: Messages = de;

/** Ersetzt {name}-Platzhalter in einem Text. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
