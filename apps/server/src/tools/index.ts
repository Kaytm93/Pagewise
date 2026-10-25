import { getExams, getTimetable } from './planner';
import { ToolRegistry } from './registry';
import { webSearch } from './web-search';

export type { ToolBudget, ToolContext, ToolOutcome, ToolSpec } from './registry';
export { ToolError, ToolRegistry } from './registry';
export { MAX_WEB_SEARCHES } from './web-search';

/**
 * Die Werkzeuge, die Pagewise seinen Chat-Modellen anbietet: nur lesende Abfragen von Stundenplan und Tests,
 * dazu die Websuche (nur wenn sie eingeschaltet und mit Schlüssel eingerichtet ist).
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry().register(getTimetable).register(getExams).register(webSearch);
}

export { WEEKDAY_NAMES } from './planner';
