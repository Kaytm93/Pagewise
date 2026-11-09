import type { LucideIcon } from 'lucide-react';
import {
  Ban,
  CircleAlert,
  CircleCheck,
  CircleX,
  ClockAlert,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Hourglass,
  Terminal,
} from 'lucide-react';
import { useState } from 'react';
import type { ChatCodeRun } from '../../../api/types';
import { format, messages as m } from '../../../i18n';
import { useSession } from '../../../session/SessionProvider';

type Load =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; script: string };

/**
 * Zeichen und Zustand je festem Ausgangscode (CodeOutcome, D-079): alle neun Codes haben Text und
 * Symbol. Grenzen (Ausgabe, Speicher, Platte) teilen sich das Sanduhr-Symbol, alles Unerwartete
 * fällt auf das Hinweis-Symbol zurück und wird roh gezeigt.
 */
const OUTCOME_MARKS: Record<string, { icon: LucideIcon; danger: boolean }> = {
  ok: { icon: CircleCheck, danger: false },
  error: { icon: CircleX, danger: true },
  timeout: { icon: ClockAlert, danger: true },
  cancelled: { icon: Ban, danger: true },
  output_limit: { icon: Hourglass, danger: true },
  memory_limit: { icon: Hourglass, danger: true },
  disk_limit: { icon: Hourglass, danger: true },
  unavailable: { icon: CircleAlert, danger: true },
  failed: { icon: CircleAlert, danger: true },
};

/**
 * Dauer lesbar: unter einer Minute „12,4 s“ (Komma wie im Deutschen), sonst „1:20 min“ (Sekunden
 * zweistellig, gerundet). „s“ und „min“ sind Einheiten und stehen in der i18n, nicht hier.
 */
function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) {
    return format(m.chat.code.seconds, { seconds: seconds.toFixed(1).replace('.', ',') });
  }
  const total = Math.round(seconds);
  return format(m.chat.code.minutes, {
    minutes: Math.floor(total / 60),
    seconds: String(total % 60).padStart(2, '0'),
  });
}

/**
 * Art-Symbol einer Datei nach ihrer Endung, wie im Datei-Panel (H-C02, FilePanel.tsx): Bilder,
 * Tabellen, Text und PDF, sonst das allgemeine Datei-Symbol. Öffnen und Herunterladen bleibt im
 * Datei-Panel; die Karte zeigt nur, was entstanden ist.
 */
function FileIcon({ name }: { name: string }) {
  const extension = name.split('.').pop() ?? '';
  const Icon = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)
    ? FileImage
    : ['xlsx', 'csv'].includes(extension)
      ? FileSpreadsheet
      : ['pdf', 'txt', 'md'].includes(extension)
        ? FileText
        : File;
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />;
}

/**
 * Ein Lauf von Code, den das Modell geschrieben hat (D-079, Karte aufgewertet in H-C06): Unter der
 * Antwort steht, dass Code lief, mit Zeichen und Text je festem Ausgangscode, der lesbaren Dauer und
 * einem Raster der erzeugten Dateien (Name und Art-Symbol; Öffnen und Herunterladen läuft über das
 * Datei-Panel). Das Skript holt die Ansicht erst beim Aufklappen (details wie in der Oberfläche) und
 * zeigt es nur als Text; es wird nie ausgeführt oder als Markup dargestellt. Die Ausgabe des Programms
 * bleibt beim Modell und wird nicht gespeichert.
 */
function CodeRunItem({ run }: { run: ChatCodeRun }) {
  const { api } = useSession();
  const t = m.chat.code;
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ state: 'idle' });

  // Das Skript wird erst beim ersten Aufklappen geholt und danach nicht erneut geladen.
  function fetchScript() {
    if (load.state === 'ready' || load.state === 'loading') return;
    setLoad({ state: 'loading' });
    api
      .codeRun(run.id)
      .then((detail) => setLoad({ state: 'ready', script: detail.script }))
      .catch(() => setLoad({ state: 'failed' }));
  }

  const mark = OUTCOME_MARKS[run.outcome] ?? { icon: CircleAlert, danger: true };
  const OutcomeIcon = mark.icon;
  return (
    <li className="rounded-box bg-paper px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Terminal aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
        <span className="min-w-0 font-medium break-words">
          {run.purpose ? format(t.ranWith, { purpose: run.purpose }) : t.ran}
        </span>
        <span
          className={`inline-flex items-center gap-1 ${mark.danger ? 'text-danger' : 'text-ink-secondary'}`}
        >
          <OutcomeIcon aria-hidden="true" className="size-4 shrink-0" />
          {(t.outcomes as Record<string, string>)[run.outcome] ?? run.outcome}
        </span>
        <span className="text-ink-muted">{formatDuration(run.durationMs)}</span>
      </div>
      {run.files.length > 0 ? (
        <ul
          aria-label={t.filesLabel}
          className="mt-2 grid gap-1 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]"
        >
          {run.files.map((name) => (
            <li
              key={name}
              title={name}
              className="flex min-h-9 min-w-0 items-center gap-2 rounded-control bg-canvas px-2 text-sm text-ink"
            >
              <FileIcon name={name} />
              <span className="min-w-0 truncate">{name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 break-words text-ink-secondary">{t.noFiles}</p>
      )}
      <details
        className="mt-1 text-sm text-ink-secondary"
        onToggle={(event) => {
          setOpen(event.currentTarget.open);
          if (event.currentTarget.open) fetchScript();
        }}
      >
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-ink-secondary underline underline-offset-2 hover:text-ink">
          {open ? t.hide : t.show}
        </summary>
        <div className="pb-1">
          {load.state === 'loading' && (
            <p role="status" className="mt-1 text-ink-muted">
              {t.loading}
            </p>
          )}
          {load.state === 'failed' && <p className="mt-1 text-danger">{t.failed}</p>}
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
      </details>
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
