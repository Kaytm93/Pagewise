import { getExams, getTimetable } from './planner';
import { ToolRegistry } from './registry';

export type { ToolContext, ToolOutcome, ToolSpec } from './registry';
export { ToolRegistry } from './registry';

/** Die Werkzeuge, die Pagewise seinen Chat-Modellen anbietet: nur lesende Abfragen von Stundenplan und Tests. */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry().register(getTimetable).register(getExams);
}

export { WEEKDAY_NAMES } from './planner';
