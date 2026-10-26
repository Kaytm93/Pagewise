import { Loader2, WifiOff } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { messages as m } from '../i18n';
import { Button } from '../ui/Button';
import { useConnection } from './ConnectionProvider';

/**
 * Höhe der Hinweisfläche als CSSOM-Variable am Wurzelelement (wie `--kb` bei der Tastatur): Die
 * Kopfzeile hält mit `top: var(--cb-h, 0px)` unter dem Hinweis, beide kleben am selben Anker, ohne
 * sich zu überdecken. Variable über `style.setProperty`, nie als Inline-Style im Markup (CSP, D-023).
 */
export const CONNECTION_BANNER_VAR = '--cb-h';

/**
 * Misst den Hinweis und hält die Variable aktuell. Die Variable entfernt nicht diese Funktion, sondern
 * `ConnectionBanner`: Ein Platzhalter braucht die Höhe noch, wenn der Hinweis schon weg ist.
 */
function BannerHeight() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    // Der sticky-Hänger ist das Elternelement (`.cb-h`); seine ganze Höhe zählt.
    const wrapper = ref.current?.parentElement;
    if (!wrapper) return;
    const set = () => {
      // Ganze Höhe des Hängers (Karte plus oberes Polster): genau so viel hält die Kopfzeile zurück.
      const height = wrapper.offsetHeight;
      if (height > 0) root.style.setProperty(CONNECTION_BANNER_VAR, `${height}px`);
    };
    set();
    // Zeilenumbruch und „Prüfe …“ ändern die Höhe: die Kopfzeile hält mit (Werkzeug ohne Beobachter: konstanter Wert).
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(set);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className="sr-only" aria-hidden="true" />;
}

/**
 * Hinweis, wenn der Mac nicht antwortet. Er blockiert nichts: geladene Ansichten und Entwürfe bleiben sichtbar,
 * die Seite lässt sich weiter lesen. Sobald der Server wieder antwortet, verschwindet er von selbst.
 * Er nimmt Platz im Dokumentfluss ein (M4-T008): oberhalb der Kopfzeile, die er nach unten schiebt;
 * die Kopfzeile hält beim Scrollen unter ihm (top: var(--cb-h, 0px)).
 *
 * Endet er, während die Seite gescrollt ist, bleibt seine Höhe als leerer Platzhalter stehen, bis die
 * Seite wieder oben steht (M4-T037). Fiele die Höhe sofort aus dem Fluss, rückten Kopfzeile und Inhalt
 * mitten im Lesen um die Hinweishöhe nach oben. Oben gibt es keinen Lesestand zu halten: dort entfällt
 * der Platzhalter sofort.
 */
export function ConnectionBanner() {
  const { status, checking, retry } = useConnection();
  const hanging = status !== 'online';
  const [holding, setHolding] = useState(false);
  const wasHanging = useRef(hanging);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (hanging) {
      wasHanging.current = true;
      setHolding(false);
      return;
    }
    if (!wasHanging.current) return;
    wasHanging.current = false;
    if (window.scrollY > 0 && parseFloat(root.style.getPropertyValue(CONNECTION_BANNER_VAR)) > 0) {
      setHolding(true);
    } else {
      root.style.removeProperty(CONNECTION_BANNER_VAR);
    }
  }, [hanging]);

  useEffect(() => {
    if (!holding) return;
    const release = () => {
      if (window.scrollY > 0) return;
      setHolding(false);
      document.documentElement.style.removeProperty(CONNECTION_BANNER_VAR);
    };
    window.addEventListener('scroll', release, { passive: true });
    return () => window.removeEventListener('scroll', release);
  }, [holding]);

  useLayoutEffect(
    () => () => {
      document.documentElement.style.removeProperty(CONNECTION_BANNER_VAR);
    },
    [],
  );

  if (!hanging) {
    if (!holding) return null;
    // Leerer Platzhalter in Höhe des Hinweises: hält die Kopfzeile und den Inhalt an ihrer Stelle.
    // Auf dem Mac transparent, dort gibt es keine Kopfzeile unter ihm.
    return (
      <div
        data-testid="connection-platzhalter"
        aria-hidden="true"
        className="cb-h sticky top-0 z-40 h-[var(--cb-h,0px)] bg-desk md:bg-transparent"
      />
    );
  }
  return (
    <div className="cb-h sticky top-0 z-40 flex justify-center px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
      <BannerHeight />
      <div
        role="status"
        aria-live="polite"
        data-testid="connection-banner"
        className="mo-rise pointer-events-auto flex max-w-xl flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-control-edge bg-surface px-4 py-2 text-sm text-ink shadow-lg"
      >
        <WifiOff aria-hidden="true" className="size-4 shrink-0 text-danger" />
        <span className="min-w-0 flex-1">{m.connection.banner.text}</span>
        <Button
          variant="ghost"
          onClick={retry}
          disabled={checking}
          aria-busy={checking || undefined}
        >
          {checking && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          {checking ? m.connection.banner.checking : m.common.retry}
        </Button>
      </div>
    </div>
  );
}
