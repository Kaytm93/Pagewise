import { Terminal } from 'lucide-react';
import { useId, useState } from 'react';
import type { ChatCodeRun } from '../../../api/types';
import { format, messages as m } from '../../../i18n';
import { useSession } from '../../../session/SessionProvider';

type Load =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; script: string };

/**
 * Ein Lauf von Code, den das Modell geschrieben hat (D-079): Unter der Antwort steht, dass Code lief, wie er
 * ausging und welche Dateien er angelegt hat. Das Skript holt die Ansicht erst auf Klick („Code anzeigen“) und
 * zeigt es nur als Text; es wird nie ausgeführt oder als Markup dargestellt. Die Ausgabe des Programms bleibt
 * beim Modell und wird nicht gespeichert.
 */
function CodeRunItem({ run }: { run: ChatCodeRun }) {
  const { api } = useSession();
  const t = m.chat.code;
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ state: 'idle' });

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || load.state === 'ready' || load.state === 'loading') return;
    setLoad({ state: 'loading' });
    api
      .codeRun(run.id)
      .then((detail) => setLoad({ state: 'ready', script: detail.script }))
      .catch(() => setLoad({ state: 'failed' }));
  }

  const outcomes = t.outcomes as Record<string, string>;
  const ok = run.outcome === 'ok';
  return (
    <li className="rounded-box bg-paper px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Terminal aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
        <span className="min-w-0 font-medium break-words">
          {run.purpose ? format('{ran}: {purpose}', { ran: t.ran, purpose: run.purpose }) : t.ran}
        </span>
        <span className={ok ? 'text-ink-secondary' : 'text-danger'}>
          {outcomes[run.outcome] ?? run.outcome}
        </span>
        <span className="text-ink-muted">
          {format(t.seconds, { seconds: (run.durationMs / 1000).toFixed(1).replace('.', ',') })}
        </span>
      </div>
      <p className="mt-1 break-words text-ink-secondary">
        {run.files.length > 0 ? format(t.files, { names: run.files.join(', ') }) : t.noFiles}
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="mo-press mt-1 inline-flex min-h-11 items-center rounded-control px-2 -ml-2 text-ink-secondary underline underline-offset-2 hover:text-ink"
      >
        {open ? t.hide : t.show}
      </button>
      <div id={panelId} hidden={!open}>
        {load.state === 'loading' && (
          <p role="status" className="text-ink-muted">
            {t.loading}
          </p>
        )}
        {load.state === 'failed' && <p className="text-danger">{t.failed}</p>}
        {load.state === 'ready' && (
          <>
            <pre
              // biome-ignore lint/a11y/noNoninteractiveTabindex: Der Code scrollt; ohne Fokus ließe er sich per Tastatur nicht lesen
              tabIndex={0}
              className="mt-1 max-h-80 overflow-auto rounded-control bg-canvas p-3 text-xs leading-relaxed whitespace-pre"
            >
              <code>{load.script}</code>
            </pre>
            <p className="mt-2 text-ink-muted">{t.note}</p>
          </>
        )}
      </div>
    </li>
  );
}

export function CodeRunList({ runs }: { runs: ChatCodeRun[] }) {
  if (runs.length === 0) return null;
  return (
    <ul aria-label={m.chat.code.label} className="mt-3 space-y-2">
      {runs.map((run) => (
        <CodeRunItem key={run.id} run={run} />
      ))}
    </ul>
  );
}
