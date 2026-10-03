import { HealthStatus } from './HealthStatus';
import { messages as m } from './i18n';
import { useHealth } from './use-health';

export function App() {
  const { state, retry } = useHealth();

  return (
    <div className="flex min-h-dvh flex-col md:grid md:grid-cols-[18rem_1fr]">
      <aside
        className="border-b border-line bg-canvas px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-6 md:border-r md:border-b-0"
        aria-label={m.sidebar.subjects}
      >
        <p className="font-heading text-xl tracking-tight">{m.app.name}</p>
        <h2 className="mt-8 text-meta font-medium text-ink-muted">{m.sidebar.subjects}</h2>
        <div className="mt-2 rounded-box bg-paper p-4">
          <p className="font-medium">{m.sidebar.emptyTitle}</p>
          <p className="mt-1 text-sm text-ink-secondary">{m.sidebar.emptyHint}</p>
        </div>
      </aside>

      <main className="flex-1 bg-workspace px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] md:px-10 md:py-12">
        <div className="mx-auto max-w-2xl rounded-card border border-line bg-canvas p-6 md:p-8">
          <h1 className="font-heading text-title">{m.main.title}</h1>
          <p className="mt-3 text-ink-secondary">{m.main.lead}</p>
          <HealthStatus state={state} onRetry={retry} />
        </div>
      </main>
    </div>
  );
}
