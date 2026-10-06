import { Check, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import type { ActivityEntry } from '../../api/types';
import { format, messages as m } from '../../i18n';

function toolLabel(tool: string): string {
  const labels = m.chat.agent.tools as Record<string, string>;
  return labels[tool] ?? tool;
}

function stepText(step: ActivityEntry): string {
  const label = toolLabel(step.tool);
  return step.target ? `${label}: ${step.target}` : label;
}

function StateMark({ state }: { state: ActivityEntry['state'] }) {
  if (state === 'running') {
    return (
      <span
        aria-hidden="true"
        className="inline-block size-2 shrink-0 animate-pulse rounded-pill bg-ink-muted"
      />
    );
  }
  const Icon = state === 'error' ? X : Check;
  return (
    <Icon
      aria-hidden="true"
      className={`size-3.5 shrink-0 ${state === 'error' ? 'text-danger' : 'text-ink-muted'}`}
    />
  );
}

const stateName = (state: ActivityEntry['state']): string =>
  state === 'running'
    ? m.chat.agent.stepRunning
    : state === 'error'
      ? m.chat.agent.stepError
      : m.chat.agent.stepDone;

/** Wie viele Schritte während der Arbeit sichtbar bleiben (die neuesten). */
const LIVE_VISIBLE = 4;

function Steps({ steps }: { steps: ActivityEntry[] }) {
  return (
    <ol aria-label={m.chat.agent.steps} className="space-y-1 text-sm text-ink-secondary">
      {steps.map((step) => (
        <li key={step.id} className="flex min-w-0 items-center gap-2">
          <StateMark state={step.state} />
          <span className="min-w-0 break-all">{stepText(step)}</span>
          <span className="sr-only">{stateName(step.state)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Was ein Agent tut: während der Arbeit die neuesten Schritte, danach eingeklappt als „Was der Agent getan
 * hat“. Es sind nur Werkzeug und Ziel zu sehen, nie Inhalte.
 */
export function AgentActivity({ steps, live }: { steps: ActivityEntry[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  if (live) {
    return (
      <div className="mt-3">
        <Steps steps={steps.slice(-LIVE_VISIBLE)} />
      </div>
    );
  }
  return (
    <details
      className="mt-3 text-sm text-ink-secondary"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-ink-muted hover:text-ink">
        <span>{format(m.chat.agent.summary, { count: steps.length })}</span>
        <span className="sr-only">
          {open ? m.chat.agent.detailsHide : m.chat.agent.detailsShow}
        </span>
        <ChevronRight aria-hidden="true" className="mo-arrow ml-1 size-4 shrink-0" />
      </summary>
      <div className="pb-2">
        <Steps steps={steps} />
      </div>
    </details>
  );
}
