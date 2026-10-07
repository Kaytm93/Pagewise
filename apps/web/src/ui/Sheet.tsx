import type { ReactNode } from 'react';

type Width = 'prose' | 'wide';

const WIDTHS: Record<Width, string> = {
  prose: 'max-w-[760px]',
  wide: 'max-w-[1040px]',
};

/**
 * Das Blatt auf dem Schreibtisch (Gestaltung „Lagen“, D-043): Papier mit Körnung, Rand und Schatten. Der Inhalt
 * steht in einer lesbaren Breite in der Mitte. Mit `flush` füllt der Inhalt das ganze Blatt (Chat), dann
 * kümmert sich die Ansicht selbst um Abstände.
 */
export function Sheet({
  children,
  className = '',
  width = 'prose',
  flush = false,
}: {
  children: ReactNode;
  className?: string;
  width?: Width;
  flush?: boolean;
}) {
  // Mindesthöhe: das Blatt reicht auch bei wenig Inhalt genau bis an den unteren Rand, ohne dass die
  // Seite scrollt. Abgezogen werden (AppShell.tsx): Kopfzeile 56 px plus Safe-Area oben, Innenabstand
  // des Inhalts 4 px, unten max(28 px, Safe-Area unten); dazu der Stapelrand der Gestaltung
  // (--stack-space, raum.css 12 + 14 px; lagen/atelier 0). Ab „md“ ohne Kopfzeile: oben und unten
  // je 14 px (md:py-3.5) plus Stapelrand.
  const minHeight =
    'min-h-[calc(100dvh-3.75rem-env(safe-area-inset-top)-max(1.75rem,env(safe-area-inset-bottom))-var(--stack-space,0px))] ' +
    'md:min-h-[calc(100dvh-1.75rem-var(--stack-space,0px))]';
  if (flush) {
    return <div className={`lg-sheet flex flex-col ${minHeight} ${className}`}>{children}</div>;
  }
  return (
    <div className={`lg-sheet ${minHeight}`}>
      <div
        className={`mx-auto w-full ${WIDTHS[width]} px-[22px] pt-[26px] pb-12 sm:px-8 md:px-[52px] md:pt-[46px] md:pb-16 ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
