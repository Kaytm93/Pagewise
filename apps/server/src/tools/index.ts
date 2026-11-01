import { createDocument, createPresentation, createSpreadsheet } from './artifacts';
import { getExams, getTimetable } from './planner';
import { ToolRegistry } from './registry';
import { webSearch } from './web-search';

export type { ToolBudget, ToolContext, ToolOutcome, ToolSpec } from './registry';
export { ToolError, ToolRegistry } from './registry';
export { MAX_WEB_SEARCHES } from './web-search';

/**
 * Die Werkzeuge, die Pagewise seinen Chat-Modellen anbietet: lesende Abfragen von Stundenplan und Tests, die
 * Websuche (nur wenn sie eingeschaltet und mit Schlüssel eingerichtet ist) und die Datei-Werkzeuge (Dokument,
 * Präsentation; nur wenn der Schalter „Dateien“ an ist, D-074).
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(getTimetable)
    .register(getExams)
    .register(webSearch)
    .register(createDocument)
    .register(createPresentation)
    .register(createSpreadsheet);
}

export { WEEKDAY_NAMES } from './planner';
