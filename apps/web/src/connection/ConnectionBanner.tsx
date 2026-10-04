import { Loader2, WifiOff } from 'lucide-react';
import { messages as m } from '../i18n';
import { Button } from '../ui/Button';
import { useConnection } from './ConnectionProvider';

/**
 * Hinweis, wenn der Mac nicht antwortet. Er blockiert nichts: geladene Ansichten und Entwürfe bleiben sichtbar,
 * die Seite lässt sich weiter lesen. Sobald der Server wieder antwortet, verschwindet er von selbst.
 */
export function ConnectionBanner() {
  const { status, checking, retry } = useConnection();
  if (status === 'online') return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
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
