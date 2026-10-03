import { type ReactNode, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useInitialFocus, useModalLayer } from '../ui/modal';

/** Seitenleiste als Schublade für schmale Bildschirme. Teilt das Verhalten mit den Dialogen. */
export function Drawer({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const container = useModalLayer(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useInitialFocus(panelRef, container !== null);

  if (!container) return null;
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: Klick auf den Hintergrund schließt; Escape deckt die Tastatur ab
    <div
      className="fixed inset-0 z-50 bg-black/40"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="h-full w-[min(20rem,85vw)] animate-[drawer-in_0.2s_ease-out] border-r border-line bg-canvas shadow-2xl outline-none"
      >
        {children}
      </div>
    </div>,
    container,
  );
}
