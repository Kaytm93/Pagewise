import { Check, Copy, RotateCcw } from 'lucide-react';
import { memo } from 'react';
import type { ChatMessage, EngineKind } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { Button } from '../../ui/Button';
import { Link } from '../../ui/Link';
import { AgentActivity } from './AgentActivity';
import { AssetList } from './AssetList';
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
  'cli_missing',
  'cli_broken',
  'profile_missing',
]);

type Texts = Record<string, string>;

/**
 * Text zu einem Fehlercode. Bei einem Agenten zuerst die Texte zur Art des Zugangs (ein abgelehnter Schlüssel
 * heißt beim Abo etwas anderes als bei Z.ai), dann die des Agenten, dann die allgemeinen.
 */
function errorText(code: string | null, engineKind: EngineKind | null): string {
  if (code && engineKind) {
    const byKind = (m.chat.agentErrors.byKind as Record<string, Texts>)[engineKind]?.[code];
    if (byKind) return byKind;
  }
  if (code) {
    const agent = (m.chat.agentErrors as unknown as Texts)[code];
    if (typeof agent === 'string') return agent;
  }
  return ((m.chat.errors as Texts)[code ?? ''] ?? m.chat.errors.unknown) as string;
}

interface Props {
  message: ChatMessage;
  /** Die Antwort wird gerade geschrieben. */
  live: boolean;
  thinking: boolean;
  /** Nur die letzte Antwort lässt sich wiederholen, und nur wenn sie nicht gelungen ist. */
  canRetry: boolean;
  onRetry: () => void;
  /** Art des Zugangs, über den der Agent geantwortet hat (`null`: ein Modell hat geantwortet). */
  engineKind?: EngineKind | null;
  /** Adresse zum Herunterladen einer erzeugten Datei. */
  assetUrl?: (id: string) => string;
  /** Nur gesetzt, wenn ein Modell eines Anbieters bereitsteht, das statt des Agenten antworten kann. */
  onRetryViaApi?: () => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  live,
  thinking,
  canRetry,
  onRetry,
  engineKind = null,
  assetUrl,
  onRetryViaApi,
}: Props) {
  const { copied, copy } = useCopy();

  if (message.role === 'user') {
    return (
      <article className="flex justify-end">
        <h3 className="sr-only">{m.chat.you}</h3>
        <p className="max-w-[84%] rounded-[14px_14px_4px_14px] border border-line-warm bg-paper px-4 py-3 text-[1.0313rem] leading-relaxed break-words whitespace-pre-wrap">
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
  const byAgent = message.engineProfileId !== null;
  const working = message.activity[message.activity.length - 1];

  return (
    <article aria-busy={live || undefined}>
      <h3 className="sr-only">{m.chat.answer}</h3>
      {hasText && <Markdown text={message.content} />}
      {hasText && live && (
        <p className="mt-2 flex min-h-6 items-center gap-2 text-sm text-ink-muted">
          <span aria-hidden="true" className="mo-caret" />
          {m.chat.writing}
        </p>
      )}
      {!hasText && live && (
        <p className="flex items-center gap-2 text-ink-muted">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-pill bg-ink-muted" />
          {byAgent && working
            ? format(m.chat.agent.workingOn, { step: working.target ?? working.tool })
            : thinking
              ? m.chat.thinking
              : byAgent
                ? m.chat.agent.working
                : m.chat.waiting}
        </p>
      )}
      {!hasText && !live && message.status === 'complete' && (
        <p className="text-ink-muted">{m.chat.emptyAnswer}</p>
      )}

      {byAgent && <AgentActivity steps={message.activity} live={live} />}
      {assetUrl && <AssetList assets={message.assets} url={assetUrl} />}

      {failed && (
        <div className="mt-3 rounded-box bg-paper px-4 py-3 text-sm">
          <p className="font-medium text-danger">{errorText(message.errorCode, engineKind)}</p>
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
          {canRetry && byAgent && onRetryViaApi && (
            <Button variant="ghost" onClick={onRetryViaApi}>
              {m.chat.retryViaApi}
            </Button>
          )}
          {message.model && <span className="px-3 break-all">{message.model}</span>}
        </div>
      )}
    </article>
  );
});
