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
  // Mindesthöhe: das Blatt reicht auch bei wenig Inhalt bis fast zum unteren Rand.
  const minHeight = 'min-h-[calc(100dvh-7rem)] md:min-h-[calc(100dvh-4.75rem)]';
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
