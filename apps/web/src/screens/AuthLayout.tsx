import type { ReactNode } from 'react';
import { messages as m } from '../i18n';

/** Rahmen für Einrichtung und Anmeldung: eine ruhige Karte auf der Arbeitsfläche. */
export function AuthLayout({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-workspace px-4 py-10 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md">
        <p className="mb-6 font-heading text-lg text-ink-secondary">{m.app.name}</p>
        <div className="rounded-card border border-line bg-canvas p-6 sm:p-8">
          <h1 className="font-heading text-3xl tracking-tight text-ink sm:text-title">{title}</h1>
          {lead && <p className="mt-3 text-ink-secondary">{lead}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
