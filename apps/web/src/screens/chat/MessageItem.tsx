import { Check, Copy, RotateCcw } from 'lucide-react';
import { memo } from 'react';
import type { ChatMessage } from '../../api/types';
import { messages as m } from '../../i18n';
import { Button } from '../../ui/Button';
import { Link } from '../../ui/Link';
import { Markdown } from './Markdown';
import { useCopy } from './useCopy';

/** Fehler, bei denen die Einstellungen weiterhelfen. */
const NEEDS_SETTINGS = new Set([
  'auth_failed',
  'no_key',
  'no_model',
  'model_not_found',
  'no_package',
  'plan_expired',
  'model_not_allowed',
]);

function errorText(code: string | null): string {
  const errors = m.chat.errors as Record<string, string>;
  return (code ? errors[code] : undefined) ?? m.chat.errors.unknown;
}

interface Props {
  message: ChatMessage;
  /** Die Antwort wird gerade geschrieben. */
  live: boolean;
  thinking: boolean;
  /** Nur die letzte Antwort lässt sich wiederholen, und nur wenn sie nicht gelungen ist. */
  canRetry: boolean;
  onRetry: () => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  live,
  thinking,
  canRetry,
  onRetry,
}: Props) {
  const { copied, copy } = useCopy();

  if (message.role === 'user') {
    return (
      <article className="flex justify-end">
        <h3 className="sr-only">{m.chat.you}</h3>
        <p className="max-w-[85%] rounded-card bg-paper px-4 py-3 break-words whitespace-pre-wrap">
          {message.content}
        </p>
      </article>
    );
  }

  const failed = message.status === 'error';
  const note =
    message.status === 'stopped'
      ? m.chat.stoppedNote
      : message.status === 'interrupted'
        ? m.chat.interruptedNote
        : null;
  const hasText = message.content.trim() !== '';

  return (
    <article aria-busy={live || undefined}>
      <h3 className="sr-only">{m.chat.answer}</h3>
      {hasText && <Markdown text={message.content} />}
      {!hasText && live && (
        <p className="flex items-center gap-2 text-ink-muted">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-pill bg-ink-muted" />
          {thinking ? m.chat.thinking : m.chat.waiting}
        </p>
      )}
      {!hasText && !live && message.status === 'complete' && (
        <p className="text-ink-muted">{m.chat.emptyAnswer}</p>
      )}

      {failed && (
        <div className="mt-3 rounded-box bg-paper px-4 py-3 text-sm">
          <p className="font-medium text-danger">{errorText(message.errorCode)}</p>
          {message.errorCode && NEEDS_SETTINGS.has(message.errorCode) && (
            <Link to={{ name: 'settings' }} className="mt-1 inline-block">
              {m.chat.openSettings}
            </Link>
          )}
        </div>
      )}
      {note && <p className="mt-3 text-sm text-ink-muted">{note}</p>}

      {!live && (
        <div className="mt-2 -ml-3 flex flex-wrap items-center gap-x-1 text-meta text-ink-muted">
          {hasText && (
            <button
              type="button"
              onClick={() => void copy(message.content)}
              aria-label={m.chat.copy}
              className="inline-flex size-11 items-center justify-center rounded-control hover:bg-paper hover:text-ink"
            >
              {copied ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Copy aria-hidden="true" className="size-4" />
              )}
            </button>
          )}
          {canRetry && (
            <Button variant="ghost" onClick={onRetry}>
              <RotateCcw aria-hidden="true" className="size-4" />
              {m.chat.retry}
            </Button>
          )}
          {message.model && <span className="px-3 break-all">{message.model}</span>}
        </div>
      )}
    </article>
  );
});
