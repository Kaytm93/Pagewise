import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInitialFocus, useModalLayer } from '../ui/modal';

// Sicherheitsnetz: Endet die Ausfahrt nie (Tab im Hintergrund hält Animationen an), schließt die Schublade trotzdem.
const EXIT_FALLBACK_MS = 1000;

/**
 * Seitenleiste als Schublade für schmale Bildschirme: der Heftrücken fährt von links ein und beim Schließen
 * wieder aus. Teilt das Verhalten mit den Dialogen (Escape, Fokus, Sperre).
 *
 * Die Kinder bekommen `close` (Ausfahrt starten, danach `onClose`), damit auch ein Seitenwechsel aus der
 * Schublade heraus sie sanft schließt. Die Ausfahrt hängt an `--m` und `--t-*` (motion.css): bei „Reduziert“
 * blendet sie nur aus, bei „Aus“ ist die Schublade sofort zu und `onClose` läuft ohne Warten.
 */
export function Drawer({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
  }, []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const container = useModalLayer(close);
  const panelRef = useRef<HTMLDivElement>(null);
  useInitialFocus(panelRef, container !== null);

  useEffect(() => {
    if (!closing) return;
    const panel = panelRef.current;
    const finish = () => onCloseRef.current();
    const animation = panel ? window.getComputedStyle(panel).animationName : 'none';
    // Ohne Animation (Stufe „Aus“, kein Layout) gäbe es kein animationend.
    if (!panel || !animation || animation === 'none') {
      finish();
      return;
    }
    const onEnd = (event: AnimationEvent) => {
      if (event.target === panel) finish();
    };
    panel.addEventListener('animationend', onEnd);
    const timer = window.setTimeout(finish, EXIT_FALLBACK_MS);
    return () => {
      panel.removeEventListener('animationend', onEnd);
      window.clearTimeout(timer);
    };
  }, [closing]);

  if (!container) return null;
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: Klick auf den Hintergrund schließt; Escape deckt die Tastatur ab
    <div
      className={`lg-scrim fixed inset-0 z-50 ${closing ? 'pointer-events-none animate-[lg-fade-out_var(--t-med)_var(--ease)_both]' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`lg-binder h-full w-[min(calc(18.75rem+env(safe-area-inset-left)),86vw)] rounded-r-[18px] pl-[env(safe-area-inset-left)] shadow-[12px_0_40px_-8px_rgba(var(--shadow),calc(var(--shadow-a)*2.4))] outline-none ${
          closing
            ? 'animate-[lg-drawer-out_var(--t-med)_var(--ease)_both]'
            : 'animate-[lg-drawer-in_var(--t-slow)_var(--spring)_both]'
        }`}
      >
        {children(close)}
      </div>
    </div>,
    container,
  );
}
