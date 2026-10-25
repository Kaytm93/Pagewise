import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { messages as m } from '../i18n';

/**
 * Eine offene Ebene (Dialog oder Schublade). Die Ebenen bilden einen Stapel: Escape, Tab-Schleife,
 * Hintergrundsperre und Scrollsperre gehören immer der obersten Ebene (S-01). Der Stapel steht auf
 * Modulebene, weil sich Ebenen verschachteln können (Bestätigung über einem Formular) und jede ihr
 * eigenes React-Bauteil ist.
 */
interface Layer {
  container: HTMLElement;
  close: () => void;
}

const stack: Layer[] = [];

/** Vom Dialog gesperrte Geschwister von <body>, damit nur eigene `inert`-Marken wieder entfernt werden. */
const inerted = new Set<Element>();

/** Zuletzt angeklicktes bedienbares Element: Safari und iOS fokussieren Knöpfe beim Klick nicht. */
let lastTrigger: HTMLElement | null = null;
const TRIGGER = 'button, a[href], [role="button"], summary, input, select, textarea, [tabindex]';
if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (event) => {
      lastTrigger =
        event.target instanceof Element ? event.target.closest<HTMLElement>(TRIGGER) : null;
    },
    true,
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Nur die oberste Ebene ist erreichbar; alles andere unter <body> ist für Tastatur und Screenreader gesperrt. */
function syncBackground() {
  const top = stack[stack.length - 1]?.container ?? null;
  for (const element of Array.from(document.body.children)) {
    if (top && element !== top) {
      if (!element.hasAttribute('inert')) {
        element.setAttribute('inert', '');
        inerted.add(element);
      }
    } else if (inerted.delete(element)) {
      element.removeAttribute('inert');
    }
  }
}

let previousOverflow = '';

/** Tab und Shift+Tab bleiben in der obersten Ebene und laufen dort im Kreis. */
function trapFocus(event: KeyboardEvent, container: HTMLElement) {
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.closest('[hidden], [inert]'),
  );
  const panel = container.querySelector<HTMLElement>('[role="dialog"]');
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    panel?.focus();
    return;
  }
  const active = document.activeElement;
  const inside = active !== null && container.contains(active);
  if (event.shiftKey) {
    if (!inside || active === first || active === panel) {
      event.preventDefault();
      last.focus();
    }
  } else if (!inside || active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Ein Listener für alle Ebenen: Escape schließt nur die oberste, ungespeicherte Eingaben darunter bleiben. */
function onKeyDown(event: KeyboardEvent) {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (event.key === 'Escape') {
    event.stopPropagation();
    top.close();
  } else if (event.key === 'Tab') {
    trapFocus(event, top.container);
  }
}

/**
 * Gemeinsames Verhalten für Dialoge und Schubladen: Escape schließt die oberste Ebene, der Hintergrund ist für
 * Tastatur und Screenreader gesperrt (`inert`), der Fokus bleibt in der Ebene und kehrt danach zum Auslöser
 * zurück, die Seite scrollt nicht, bis die letzte Ebene zu ist.
 * Gibt den Container zurück, in den per Portal gerendert wird.
 */
export function useModalLayer(onClose: () => void): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    setContainer(host);

    // Safari fokussiert einen angeklickten Knopf nicht: dann gilt das zuletzt angeklickte Element.
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : lastTrigger;

    const layer: Layer = { container: host, close: () => closeRef.current() };
    stack.push(layer);
    if (stack.length === 1) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', onKeyDown);
    }
    syncBackground();

    return () => {
      host.remove();
      stack.splice(stack.indexOf(layer), 1);
      syncBackground();
      if (stack.length === 0) {
        document.removeEventListener('keydown', onKeyDown);
        document.body.style.overflow = previousOverflow;
      }
      setContainer(null);
      // Der Auslöser kann inzwischen aus dem DOM sein (die Ansicht hat neu gezeichnet): dann nimmt die
      // nächste Ebene oder der Hauptbereich den Fokus, statt dass er auf <body> verloren geht.
      if (opener?.isConnected) {
        opener.focus();
      } else {
        const below =
          stack[stack.length - 1]?.container.querySelector<HTMLElement>('[role="dialog"]');
        (below ?? document.getElementById('main'))?.focus({ preventScroll: true });
      }
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

const PAD_X =
  'pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))] sm:px-6';

/**
 * Fußzeile mit den Knöpfen eines Dialogs: bleibt am unteren Rand des Dialogs stehen, auch wenn der Inhalt
 * scrollt (Textfelder darüber laufen unter ihr durch). Gehört ans Ende des Inhalts von `Modal`.
 */
export function ModalFooter({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`lg-dialog-foot sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t border-line-warm bg-sheet pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:pb-6 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Dialog: auf dem Handy ein Blatt am unteren Rand, sonst mittig. Die Fläche ist deckend und gehört dem Dialog
 * (`lg-dialog`, lagen.css), unabhängig von der Hülle der Designrichtung. Kopf und Fußzeile bleiben stehen,
 * der Inhalt dazwischen scrollt.
 */
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
      className="lg-scrim fixed inset-0 z-50 flex items-end justify-center pb-[var(--kb,0px)] sm:items-center sm:p-4 sm:pb-[max(1rem,var(--kb,0px))]"
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
        className={`lg-dialog lg-pop flex max-h-[calc(92dvh-var(--kb,0px))] w-full flex-col overflow-hidden rounded-t-card outline-none sm:rounded-card ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
      >
        <div className={`flex shrink-0 items-start justify-between gap-4 pt-5 sm:pt-6 ${PAD_X}`}>
          <h2 id={titleId} className="min-w-0 font-heading text-xl break-words">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={m.common.close}
            className="mo-press -mt-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink-muted hover:bg-paper hover:text-ink"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        {description && (
          <p
            id={descriptionId}
            className={`mt-1 shrink-0 text-sm break-words text-ink-secondary ${PAD_X}`}
          >
            {description}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className={`lg-dialog-inner mt-4 ${PAD_X}`}>{children}</div>
        </div>
      </div>
    </div>,
    container,
  );
}
