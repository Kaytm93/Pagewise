import { Check, X } from 'lucide-react';
import type { ActivityEntry } from '../../api/types';
import { format, messages as m } from '../../i18n';

/** Werkzeuge, die ein Modell im Chat aufrufen kann (Stundenplan, Tests). Alles andere ist Arbeit eines Agenten. */
const MODEL_TOOLS = new Set(['get_timetable', 'get_exams']);

export const isModelTool = (entry: ActivityEntry): boolean => MODEL_TOOLS.has(entry.tool);

function label(entry: ActivityEntry): string {
  const names = m.chat.tools as Record<string, string>;
  const name = names[entry.tool] ?? entry.tool;
  return entry.target ? format('{name}: {target}', { name, target: entry.target }) : name;
}

/**
 * Hinweis an der Antwort, welche Daten das Modell abgefragt hat („Stundenplan eingesehen“). Es zeigt nie die
 * Daten selbst, nur dass und welches Werkzeug lief, damit die Person weiß, was an den Anbieter gegangen ist.
 */
export function ToolNotes({ steps }: { steps: ActivityEntry[] }) {
  const notes = steps.filter(isModelTool);
  if (notes.length === 0) return null;
  return (
    <ul aria-label={m.chat.toolNotes} className="mb-3 space-y-1">
      {notes.map((step) => (
        <li
          key={step.id}
          className="flex min-h-9 items-center gap-2 border-b border-dashed border-line-warm text-sm text-ink-secondary"
        >
          {step.state === 'running' ? (
            <span
              aria-hidden="true"
              className="inline-block size-2 shrink-0 animate-pulse rounded-pill bg-ink-muted"
            />
          ) : step.state === 'error' ? (
            <X aria-hidden="true" className="size-4 shrink-0 text-danger" />
          ) : (
            <Check aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
          )}
          <span className="min-w-0 break-words">{label(step)}</span>
          <span className="sr-only">
            {step.state === 'running'
              ? m.chat.toolRunning
              : step.state === 'error'
                ? m.chat.toolFailed
                : m.chat.toolDone}
          </span>
        </li>
      ))}
    </ul>
  );
}
