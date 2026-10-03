import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { messages as m } from '../i18n';

/**
 * Gemeinsames Verhalten für Dialoge und Schubladen: Escape schließt, der Hintergrund ist für
 * Tastatur und Screenreader gesperrt (`inert`), der Fokus kehrt danach zurück, die Seite scrollt nicht.
 * Gibt den Container zurück, in den per Portal gerendert wird.
 */
export function useModalLayer(onClose: () => void): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const layer = document.createElement('div');
    document.body.appendChild(layer);
    setContainer(layer);

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const blocked: Element[] = [];
    for (const sibling of Array.from(document.body.children)) {
      if (sibling !== layer && !sibling.hasAttribute('inert')) {
        sibling.setAttribute('inert', '');
        blocked.push(sibling);
      }
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      for (const element of blocked) element.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
      layer.remove();
      setContainer(null);
      opener?.focus();
    };
  }, []);

  return container;
}

/** Fokus beim Öffnen auf das erste Element mit autofocus, sonst auf den Dialog selbst. */
export function useInitialFocus(ref: React.RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const panel = ref.current;
    if (!panel) return;
    // Hat ein Element im Dialog den Fokus schon (z. B. ein nachgeladenes Suchfeld), bleibt er dort.
    if (document.activeElement !== panel && panel.contains(document.activeElement)) return;
    const target = panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel;
    target.focus();
  }, [ref, active]);
}

interface ModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  /** Breiterer Dialog für Formulare mit Tabellen oder viel Text. */
  wide?: boolean;
  children: ReactNode;
}

/** Dialog: auf dem Handy ein Blatt am unteren Rand, sonst mittig. Schatten gibt es nur für Overlays. */
export function Modal({ title, description, onClose, wide = false, children }: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const container = useModalLayer(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useInitialFocus(panelRef, container !== null);

  if (!container) return null;
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: Klick auf den Hintergrund schließt; Escape und der Schließen-Button decken die Tastatur ab
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-card border border-line bg-canvas p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl outline-none sm:rounded-card sm:p-6 ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-heading text-xl">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={m.common.close}
            className="-mt-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        {description && (
          <p id={descriptionId} className="mt-1 text-sm text-ink-secondary">
            {description}
          </p>
        )}
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    container,
  );
}
