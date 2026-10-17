import { ArrowLeft, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react';
import { messages as m } from '../../i18n';
import type { Route } from '../../router';
import { Link } from '../../ui/Link';

interface Props {
  title: string;
  backTo: Route;
  /** Name des Fachs oder der Untergruppe, zu der der Chat gehört. */
  backName: string;
  modelLabel: string;
  modelAriaLabel: string;
  modelSource: string | null;
  onModel: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/**
 * Kopf der Chatansicht in der Richtung „Lagen“ (M1-T3): links die Fachkante in `--subj`, daneben der
 * Rückweg ins Fach, darunter Titel und Modell-Knopf. Die Fläche ist immer sichtbar, auch ohne Bewegung;
 * Umbenennen und Löschen bleiben an derselben Stelle wie in den anderen Richtungen.
 */
export function ChatHead({
  title,
  backTo,
  backName,
  modelLabel,
  modelAriaLabel,
  modelSource,
  onModel,
  onRename,
  onDelete,
}: Props) {
  return (
    <header className="lg-chat-head relative border-b border-line-warm px-4 py-3 sm:px-8 md:pl-10">
      <span aria-hidden="true" className="lg-chat-kante" />
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Link
          to={backTo}
          className="mo-press inline-flex min-h-11 min-w-0 items-center gap-1.5 text-sm"
        >
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 truncate">{backName}</span>
        </Link>
        <div className="-mr-2 flex shrink-0">
          <button
            type="button"
            onClick={onRename}
            aria-label={m.chat.rename}
            className="inline-flex size-11 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
          >
            <Pencil aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={m.chat.delete}
            className="inline-flex size-11 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <h1
          id="chat-title"
          className="min-w-0 py-1.5 font-heading text-[21px] break-words tracking-[-0.2px]"
        >
          {title}
        </h1>
        <button
          type="button"
          onClick={onModel}
          aria-label={modelAriaLabel}
          className="-mr-2.5 inline-flex min-h-11 max-w-[45%] shrink-0 items-center gap-2 rounded-control px-2.5 text-sm text-ink-secondary hover:bg-paper hover:text-ink"
        >
          <SlidersHorizontal aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 truncate">{modelLabel}</span>
          {modelSource && (
            <span className="hidden shrink-0 text-meta text-ink-muted sm:inline">
              {modelSource}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
