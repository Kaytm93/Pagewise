import type { ReactNode } from 'react';
import { format, messages as m } from '../../i18n';

/** Rahmen eines Onboarding-Schritts: Fortschrittsleiste, Schrittzähler, Titel. */
export function StepFrame({
  step,
  total,
  title,
  lead,
  children,
}: {
  step: number;
  total: number;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <div className="lg-app">
      <main className="min-h-dvh px-4 py-10 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <div className="lg-arrive mx-auto w-full max-w-xl">
          <p className="mb-6 font-heading text-xl tracking-[-0.3px] text-ink-secondary">
            {m.app.name}
          </p>
          <div className="lg-sheet p-6 sm:p-8">
            <div aria-hidden="true" className="flex gap-1.5">
              {Array.from({ length: total }, (_, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: feste, nie umsortierte Leiste
                  key={index}
                  className={`h-1 flex-1 rounded-pill transition-colors duration-[var(--t-slow)] ${index < step ? 'bg-primary' : 'bg-line'}`}
                />
              ))}
            </div>
            <p className="mt-4 text-meta text-ink-muted">
              {format(m.onboarding.step, { current: step, total })}
            </p>
            <h1 className="mt-1 font-heading text-3xl tracking-tight text-balance sm:text-title">
              {title}
            </h1>
            {lead && <p className="mt-3 text-ink-secondary">{lead}</p>}
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
