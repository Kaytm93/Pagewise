import { ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ActivityEntry } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { useDesign } from '../../ui/useDesign';

function toolLabel(tool: string): string {
  const labels = m.chat.agent.tools as Record<string, string>;
  return labels[tool] ?? tool;
}

/** Ziel einer Zeile: der reine Dateiname (B-04), sonst der gekürzte Hinweis — nie Inhalte, nie Pfade. */
function stepText(step: ActivityEntry): string {
  const label = toolLabel(step.tool);
  const ziel = step.file ?? step.target;
  return ziel ? `${label}: ${ziel}` : label;
}

/**
 * Der Haken eines erledigten Schritts, in allen Richtungen gleich. Der Pfad hat `pathLength="1"`, damit
 * `styles/screens.css` ihn per `stroke-dashoffset` zeichnen kann; ohne Animation steht er fertig da.
 */
function ToolCheck() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="lg-tool-check size-3.5 shrink-0 text-ink-muted"
    >
      <path pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function StateMark({ state, lagen }: { state: ActivityEntry['state']; lagen: boolean }) {
  if (state === 'running') {
    return lagen ? (
      <span aria-hidden="true" className="lg-tool-dot" data-state="running" />
    ) : (
      <span
        aria-hidden="true"
        className="inline-block size-2 shrink-0 animate-pulse rounded-pill bg-ink-muted"
      />
    );
  }
  if (state === 'error') {
    return <X aria-hidden="true" className="lg-tool-cross size-3.5 shrink-0 text-danger" />;
  }
  return <ToolCheck />;
}

const stateName = (state: ActivityEntry['state']): string =>
  state === 'running'
    ? m.chat.agent.stepRunning
    : state === 'error'
      ? m.chat.agent.stepError
      : m.chat.agent.stepDone;

/** Wie viele Schritte während der Arbeit sichtbar bleiben (die neuesten). */
const LIVE_VISIBLE = 4;

/** Ab dieser Fensterbreite läuft die Live-Spalte offen; darunter bleibt sie eingeklappt (D-106). */
const LIVE_MIN_WIDTH = 900;

/** Ist das Fenster breit genug für die offene Live-Spalte? Fehlt matchMedia (Tests): ja, wie bisher offen. */
function liveFits(): boolean {
  return (
    typeof window.matchMedia !== 'function' ||
    window.matchMedia(`(min-width: ${LIVE_MIN_WIDTH}px)`).matches
  );
}

function Steps({ steps, lagen }: { steps: ActivityEntry[]; lagen: boolean }) {
  return (
    <ol aria-label={m.chat.agent.steps} className="space-y-1 text-sm text-ink-secondary">
      {steps.map((step) => (
        <li
          key={step.id}
          className={`flex min-w-0 items-center gap-2${lagen ? ' lg-tool-row' : ''}`}
        >
          <StateMark state={step.state} lagen={lagen} />
          <span className="min-w-0 break-all">{stepText(step)}</span>
          <span className="sr-only">{stateName(step.state)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Was ein Agent tut: während der Arbeit die neuesten Schritte als schmale Live-Spalte unter der laufenden
 * Antwort (D-106). Die Zeilen kommen über den bestehenden Ereignisstrom — kein Reload, kein Polling; auf
 * schmalen Fenstern bleibt die Spalte eingeklappt (gleiche Grenze wie das Datei-Panel), danach ist sie es
 * immer. Es sind nur Werkzeug und Ziel zu sehen, nie Inhalte.
 */
export function AgentActivity({ steps, live }: { steps: ActivityEntry[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  // Wird das Fenster schmaler als die Grenze, klappt die Spalte von selbst zu (Muster des Datei-Panels).
  // Ohne matchMedia (Tests) bleibt der Zustand, wie er ist: eingeklappt.
  const [wide, setWide] = useState(liveFits);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(min-width: ${LIVE_MIN_WIDTH}px)`);
    if (typeof query.addEventListener !== 'function') return;
    const onChange = () => setWide(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  const lagen = useDesign() === 'lagen';
  if (steps.length === 0) return null;
  const failed = steps.some((step) => step.state === 'error');
  const working = live && steps.some((step) => step.state === 'running');
  // Kopf der eingeklappten Fläche: während der Arbeit der laufende Punkt, sonst Haken oder Kreuz.
  const headState: ActivityEntry['state'] = working ? 'running' : failed ? 'error' : 'done';
  if (live && wide) {
    return (
      <div className="mt-3">
        {/* In „Lagen“ bleibt jeder Schritt stehen; die anderen Richtungen zeigen die neuesten vier. */}
        <Steps steps={lagen ? steps : steps.slice(-LIVE_VISIBLE)} lagen={lagen} />
      </div>
    );
  }
  return (
    <details
      className="mt-3 text-sm text-ink-secondary"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        data-state={headState}
        className="lg-agent-head inline-flex min-h-11 max-w-full cursor-pointer items-center gap-2 whitespace-nowrap text-ink-muted hover:text-ink"
      >
        {/* Kopf in einer Zeile: Statuszeichen, Titel (kürzt sich bei Platzmangel), Pfeil. */}
        <StateMark state={headState} lagen={lagen} />
        <span className="min-w-0 truncate">
          {format(m.chat.agent.summary, { count: steps.length })}
        </span>
        <span className="sr-only">
          {open ? m.chat.agent.detailsHide : m.chat.agent.detailsShow}
        </span>
        <ChevronRight aria-hidden="true" className="mo-arrow size-4 shrink-0" />
      </summary>
      <div className="pb-2">
        <Steps steps={steps} lagen={lagen} />
      </div>
    </details>
  );
}
