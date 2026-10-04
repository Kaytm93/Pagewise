import { Pin, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { NoteSummary } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { navigate } from '../../router';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { FieldError } from '../../ui/FieldError';
import { Link } from '../../ui/Link';
import { listRow } from '../../ui/styles';
import { formatWhen } from '../chat/when';

/**
 * Hefteinträge eines Fachs oder einer Untergruppe mit Suche und „Neuer Hefteintrag“. Wie die Chats bleiben
 * sie immer in ihrem Fach. Die Suche läuft auf dem Server (Titel und Text) und nur innerhalb dieser Ansicht.
 */
export function NoteList({ subjectId, groupId }: { subjectId: string; groupId: string | null }) {
  const { api } = useSession();
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<NoteSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    // Beim Tippen kurz warten, damit nicht jeder Buchstabe eine Anfrage auslöst.
    const timer = setTimeout(
      () => {
        api
          .notes(subjectId, groupId, query)
          .then((list) => {
            if (!cancelled) setNotes(list);
          })
          .catch(() => {
            if (!cancelled) setFailed(true);
          });
      },
      query === '' ? 0 : 250,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, subjectId, groupId, query]);

  async function create() {
    setError(null);
    setCreating(true);
    try {
      const note = await api.createNote({ subjectId, groupId, title: m.notes.defaultTitle });
      navigate({ name: 'note', subjectId, noteId: note.id });
    } catch {
      setError(m.notes.createFailed);
      setCreating(false);
    }
  }

  async function remove(note: NoteSummary) {
    setBusy(true);
    try {
      await api.deleteNote(note.id);
      setNotes((current) => current?.filter((entry) => entry.id !== note.id) ?? current);
      setDeleting(null);
    } catch {
      setDeleting(null);
      setError(m.errors.unknown);
    }
    setBusy(false);
  }

  const searching = query.trim() !== '';

  return (
    <section className="mt-6" aria-label={m.notes.notes}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">{m.notes.searchLabel}</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={m.notes.searchPlaceholder}
            maxLength={100}
            autoComplete="off"
            className="min-h-11 w-full rounded-control border border-control-edge bg-sheet pr-3 pl-9 text-base text-ink focus:border-accent focus:outline-none"
          />
        </label>
        <Button variant="primary" busy={creating} onClick={() => void create()}>
          <Plus aria-hidden="true" className="size-4" />
          {m.notes.newNote}
        </Button>
      </div>

      {error && <FieldError>{error}</FieldError>}
      {failed && <p className="mt-3 text-ink-secondary">{m.notes.loadFailed}</p>}
      {!failed && notes === null && (
        <div role="status" className="mt-3">
          <span className="sr-only">{m.notes.loading}</span>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              aria-hidden="true"
              className="grid gap-2.5 border-b border-line-warm px-2 py-[18px]"
            >
              <span className="mo-shimmer h-[17px] w-[46%] rounded-[7px] bg-ink-muted/20" />
              <span className="mo-shimmer h-[13px] w-[78%] rounded-[7px] bg-ink-muted/20" />
            </div>
          ))}
        </div>
      )}
      {notes && notes.length === 0 && !searching && (
        <div className="mt-3 rounded-box bg-paper p-4">
          <p className="font-medium">{m.notes.emptyTitle}</p>
          <p className="mt-1 text-sm text-ink-secondary">{m.notes.emptyHint}</p>
        </div>
      )}
      {notes && notes.length === 0 && searching && (
        <p role="status" className="mt-3 text-ink-secondary">
          {m.notes.noResults}
        </p>
      )}
      {notes && notes.length > 0 && (
        <ul className="mt-3 divide-y divide-line-warm border-y border-line-warm">
          {notes.map((note) => (
            <li key={note.id} className="flex items-center">
              <Link to={{ name: 'note', subjectId, noteId: note.id }} className={listRow}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-heading text-[19px] tracking-[-0.15px]">
                    {note.title}
                  </span>
                  {note.pinned && (
                    <>
                      <Pin aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
                      <span className="sr-only">{m.notes.pinned}</span>
                    </>
                  )}
                </span>
                {note.excerpt !== '' && (
                  <span className="truncate text-sm text-ink-secondary">{note.excerpt}</span>
                )}
                <span className="truncate text-sm text-ink-muted">
                  {[
                    formatWhen(note.updatedAt),
                    note.sourceChatId ? m.notes.fromChat : null,
                    ...note.tags,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => setDeleting(note)}
                aria-label={format(m.notes.deleteNamed, { name: note.title })}
                className="mo-press -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink-muted hover:bg-paper hover:text-ink"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <ConfirmDialog
          title={format(m.notes.deleteTitle, { name: deleting.title })}
          description={m.notes.deleteBody}
          confirmLabel={m.common.delete}
          busy={busy}
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
