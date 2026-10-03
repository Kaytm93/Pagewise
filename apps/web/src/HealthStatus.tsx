import { format, messages as m } from './i18n';
import type { HealthState } from './use-health';

interface Props {
  state: HealthState;
  onRetry: () => void;
}

/** Zeigt Lade-, Erfolgs- und Fehlerzustand der Verbindung zum Server. */
export function HealthStatus({ state, onRetry }: Props) {
  return (
    <section className="mt-8 border-t border-line pt-6" aria-labelledby="health-heading">
      <h2 id="health-heading" className="text-meta font-medium text-ink-muted">
        {m.health.heading}
      </h2>
      <div className="mt-2" role="status" aria-live="polite">
        {state.status === 'loading' && <p className="text-ink-secondary">{m.health.loading}</p>}
        {state.status === 'ok' && (
          <p className="text-ink">{format(m.health.ok, { version: state.version })}</p>
        )}
        {state.status === 'error' && (
          <div>
            <p className="font-medium text-ink">{m.health.error}</p>
            <p className="mt-1 text-ink-secondary">{m.health.errorHint}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex min-h-11 items-center rounded-pill bg-primary px-5 text-on-primary hover:opacity-90"
            >
              {m.health.retry}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
