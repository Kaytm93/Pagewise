import { Loader2 } from 'lucide-react';
import { messages as m } from '../i18n';
import { Button } from '../ui/Button';
import { AuthLayout } from './AuthLayout';

/** Zeigt, dass der Server geprüft wird oder nicht antwortet. */
export function ConnectionScreen({
  state,
  onRetry,
}: {
  state: 'loading' | 'unreachable';
  onRetry: () => void;
}) {
  if (state === 'loading') {
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
      <Button variant="primary" onClick={onRetry}>
        {m.common.retry}
      </Button>
    </AuthLayout>
  );
}
