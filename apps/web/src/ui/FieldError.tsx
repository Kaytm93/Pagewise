import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/** Fehlertext mit Symbol, damit die Information nicht allein an der Farbe hängt. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1.5 flex items-start gap-1.5 text-sm text-danger">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
