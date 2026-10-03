import type { ReactNode } from 'react';

/** Die helle Seite auf der grauen Arbeitsfläche: flach, nur mit Haarlinie. */
export function Sheet({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`mx-auto w-full max-w-3xl rounded-card border border-line bg-canvas p-5 sm:p-8 ${className}`}
    >
      {children}
    </div>
  );
}
