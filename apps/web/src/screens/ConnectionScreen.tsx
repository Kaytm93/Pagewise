import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { messages as m } from '../i18n';
import { Button } from '../ui/Button';
import { AuthLayout } from './AuthLayout';

/** Kurze Frist, bevor der Knopf die Prüfung zeigt: Ein schneller Fehlversuch flackert nicht. */
const CHECKING_DELAY_MS = 200;

/**
 * Zeigt, dass der Server geprüft wird oder nicht antwortet. Nach „Erneut versuchen“ bleibt die
 * Fehlerkarte im Baum (kein Baumtausch, keine erneute Ankunftsanimation); der Knopf bleibt im
 * Fokus, zeigt nach kurzer Frist die laufende Prüfung und kehrt nach einem Fehlschlag zurück.
 */
export function ConnectionScreen({
  state,
  onRetry,
}: {
  state: 'loading' | 'unreachable';
  onRetry: () => void;
}) {
  const busy = state === 'loading';
  // Eigene neue Prüfung nach „Erneut versuchen“: weiter die Karte zeigen, nicht den Ladebildschirm.
  const [retrying, setRetrying] = useState(false);
  const [checking, setChecking] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Der Versuch endet, sobald der Zustand nicht mehr „lädt“ — beim Rendern freigeben: Das sieht den
  // frischen Zustand und kann nicht wie ein nachlaufender Effekt mit dem Klick verreiten.
  if (!busy && retrying) setRetrying(false);

  // Erst nach kurzer Frist zeigt der Knopf die Prüfung; ein schneller Fehlversuch flackert nicht.
  useEffect(() => {
    if (retrying) {
      const timer = window.setTimeout(() => setChecking(true), CHECKING_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
    setChecking(false);
  }, [retrying]);

  // Scheitert ein eigener Versuch, kommt der Fokus zum Knopf zurück (er stand vorher dort).
  useEffect(() => {
    if (!retrying) actionsRef.current?.querySelector('button')?.focus();
  }, [retrying]);

  if (busy && !retrying) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-workspace px-4">
        <p role="status" className="flex items-center gap-2 text-ink-secondary">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {m.connection.loading}
        </p>
      </main>
    );
  }
  return (
    <AuthLayout title={m.connection.error} lead={m.connection.hint}>
      <div ref={actionsRef}>
        <Button
          variant="primary"
          autoFocus
          aria-busy={retrying || undefined}
          onClick={() => {
            setRetrying(true);
            onRetry();
          }}
        >
          {checking && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          {checking ? m.connection.loading : m.common.retry}
        </Button>
      </div>
    </AuthLayout>
  );
}
