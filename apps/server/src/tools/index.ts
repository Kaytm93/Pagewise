import { createDocument, createFigure, createPresentation, createSpreadsheet } from './artifacts';
import { runPython } from './code';
import { getExams, getTimetable } from './planner';
import { previewFile } from './preview';
import { ToolRegistry } from './registry';
import { webSearch } from './web-search';

export { MAX_CODE_RUNS_PER_REPLY } from './code';
export { MAX_PREVIEWS_PER_REPLY } from './preview';
export type {
  CodeRunOutput,
  CodeSink,
  ToolBudget,
  ToolContext,
  ToolOutcome,
  ToolSpec,
} from './registry';
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
    .register(createSpreadsheet)
    .register(createFigure)
    .register(runPython)
    .register(previewFile);
}

export { WEEKDAY_NAMES } from './planner';
