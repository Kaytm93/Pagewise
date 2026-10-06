import { ArrowLeft, Pin, PinOff, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import type { Note } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { navigate } from '../../router';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { FieldError } from '../../ui/FieldError';
import { Link } from '../../ui/Link';
import { Segmented } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { Markdown } from '../chat/Markdown';
import { NotFoundPage } from '../NotFoundPage';
import { TEMPLATE_KEYS, TEMPLATES, type TemplateKey } from './templates';

type Phase = 'loading' | 'ready' | 'not-found' | 'error';
type Saving = 'saved' | 'dirty' | 'saving' | 'failed';
type View = 'write' | 'preview';

/** Zeit nach der letzten Eingabe, bis automatisch gespeichert wird. */
const AUTOSAVE_MS = 1200;
const MAX_CHARACTERS = 100_000;

const parseTags = (value: string): string[] => {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of value.split(',')) {
    const tag = part.trim().slice(0, 30);
    if (tag === '' || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  return tags.slice(0, 10);
};

/**
 * Hefteintrag bearbeiten: Markdown links, Vorschau rechts (auf schmalen Bildschirmen als Umschalter), Einfügen
 * von Blöcken, Anheften, Stichwörter. Änderungen werden nach kurzer Pause automatisch gespeichert und beim
 * Verlassen der Seite noch abgeschickt; der Zustand steht als Text da.
 */
export default function NotePage({ subjectId, noteId }: { subjectId: string; noteId: string }) {
  const { api } = useSession();
  const { findSubject } = useWorkspace();
  const [phase, setPhase] = useState<Phase>('loading');
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [pinned, setPinned] = useState(false);
  const [tagsText, setTagsText] = useState('');
  const [saving, setSaving] = useState<Saving>('saved');
  const [view, setView] = useState<View>('write');
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Der neueste Stand für das Speichern, unabhängig vom Rendern (auch beim Verlassen der Seite).
  const latest = useRef({ title, markdown, pinned, tagsText });
  latest.current = { title, markdown, pinned, tagsText };
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const again = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    api
      .note(noteId)
      .then((loaded) => {
        if (cancelled) return;
        setNote(loaded);
        setTitle(loaded.title);
        setMarkdown(loaded.markdown);
        setPinned(loaded.pinned);
        setTagsText(loaded.tags.join(', '));
        dirty.current = false;
        setSaving('saved');
        setPhase('ready');
      })
      .catch((error) => {
        if (!cancelled)
          setPhase(error instanceof ApiError && error.status === 404 ? 'not-found' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [api, noteId]);

  const save = useCallback(async () => {
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const { title: t, markdown: text, pinned: pin, tagsText: tagList } = latest.current;
    if (t.trim() === '' || [...t.trim()].length > 120) {
      if (alive.current) setSaving('failed');
      return;
    }
    inFlight.current = true;
    dirty.current = false;
    if (alive.current) setSaving('saving');
    try {
      const updated = await api.updateNote(noteId, {
        title: t.trim(),
        markdown: text,
        pinned: pin,
        tags: parseTags(tagList),
      });
      if (alive.current) {
        setNote(updated);
        setSaving(dirty.current ? 'dirty' : 'saved');
      }
    } catch {
      dirty.current = true;
      if (alive.current) setSaving('failed');
    } finally {
      inFlight.current = false;
      if (again.current) {
        again.current = false;
        void save();
      }
    }
  }, [api, noteId]);

  // Nach jeder Änderung: als „nicht gespeichert“ markieren und nach einer Pause speichern.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nur Änderungen der Felder lösen das aus
  useEffect(() => {
    if (phase !== 'ready' || !note) return;
    const unchanged =
      title === note.title &&
      markdown === note.markdown &&
      pinned === note.pinned &&
      parseTags(tagsText).join('\u0000') === note.tags.join('\u0000');
    if (unchanged && !dirty.current) return;
    dirty.current = true;
    setSaving((current) => (current === 'saving' ? current : 'dirty'));
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [title, markdown, pinned, tagsText]);

  // Beim Verlassen der Seite: was noch nicht gespeichert ist, abschicken (soweit der Titel gültig ist).
  useEffect(
    () => () => {
      const { title: t, markdown: text, pinned: pin, tagsText: tagList } = latest.current;
      if (dirty.current && t.trim() !== '') {
        void api
          .updateNote(noteId, {
            title: t.trim(),
            markdown: text,
            pinned: pin,
            tags: parseTags(tagList),
          })
          .catch(() => undefined);
      }
    },
    [api, noteId],
  );

  // Der Tab-Titel nennt den Eintrag, das Fach als Zusatz (Muster wie in der Hülle: „Titel · Pagewise“).
  useEffect(() => {
    if (phase !== 'ready' || !note) return;
    const subject = findSubject(subjectId);
    if (!subject || note.subjectId !== subjectId) return;
    const name = title.trim() === '' ? m.notes.untitled : title.trim();
    document.title = `${name} · ${subject.name} · ${m.app.name}`;
  }, [phase, note, title, findSubject, subjectId]);

  const subject = findSubject(subjectId);
  if (phase === 'not-found') return <NotFoundPage />;
  if (phase === 'loading') {
    return (
      <p role="status" className="mx-auto max-w-3xl px-4 py-8 text-ink-secondary">
        {m.notes.editor.loading}
      </p>
    );
  }
  if (phase === 'error' || !note) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <p className="text-ink-secondary">{m.notes.editor.loadFailed}</p>
      </div>
    );
  }
  if (!subject || note.subjectId !== subjectId) return <NotFoundPage />;

  const group = note.groupId
    ? subject.groups.find((entry) => entry.id === note.groupId)
    : undefined;
  const backTo = {
    name: 'subject',
    subjectId,
    groupId: group?.id ?? null,
    tab: 'notes',
  } as const;
  const titleInvalid = title.trim() === '' || [...title.trim()].length > 120;
  const e = m.notes.editor;

  function insert(key: TemplateKey) {
    const element = textarea.current;
    const snippet = TEMPLATES[key];
    const start = element?.selectionStart ?? markdown.length;
    const end = element?.selectionEnd ?? markdown.length;
    const before = markdown.slice(0, start);
    const after = markdown.slice(end);
    const lead =
      before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const tail = after.startsWith('\n') ? '' : '\n\n';
    const next = `${before}${lead}${snippet}${tail}${after}`;
    if ([...next].length > MAX_CHARACTERS) return;
    const caret = (before + lead + snippet).length;
    setMarkdown(next);
    setView('write');
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(caret, caret);
    });
  }

  async function remove() {
    try {
      await api.deleteNote(noteId);
    } catch (caught) {
      if (!(caught instanceof ApiError && caught.code === 'not_found')) {
        setDeleting(false);
        setActionError(m.errors.unknown);
        return;
      }
    }
    dirty.current = false;
    navigate(backTo);
  }

  const status =
    saving === 'saving'
      ? e.saving
      : saving === 'dirty'
        ? e.unsaved
        : saving === 'failed'
          ? titleInvalid
            ? e.invalidTitle
            : e.saveFailed
          : e.saved;

  return (
    <Sheet width="wide">
      <h1 className="sr-only">{title.trim() === '' ? m.notes.untitled : title.trim()}</h1>
      <Link
        to={backTo}
        className="mo-press mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm"
        aria-label={`${e.back}: ${group?.name ?? subject.name}`}
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {group?.name ?? subject.name}
      </Link>

      <div className="mt-2">
        <label htmlFor="note-title" className="sr-only">
          {e.title}
        </label>
        <input
          id="note-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          autoComplete="off"
          placeholder={e.title}
          aria-invalid={titleInvalid || undefined}
          className="w-full rounded-control border border-transparent bg-transparent px-1 py-1 font-heading text-[clamp(28px,4.4vw,44px)] leading-tight tracking-[-0.03em] text-ink placeholder:text-ink-muted aria-invalid:border-danger hover:border-line-warm focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] focus:outline-none aria-invalid:focus:border-danger aria-invalid:focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_22%,transparent)]"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p
          role="status"
          aria-live="polite"
          className={`text-sm ${saving === 'failed' ? 'text-danger' : 'text-ink-muted'}`}
        >
          {status}
        </p>
        {note.sourceChatId && (
          <Link
            to={{ name: 'chat', subjectId, chatId: note.sourceChatId }}
            className="inline-flex min-h-11 items-center text-sm"
          >
            {e.fromChat}
          </Link>
        )}
        <div className="ml-auto flex items-center">
          <Button variant="ghost" onClick={() => void save()} disabled={saving === 'saving'}>
            {e.save}
          </Button>
          <button
            type="button"
            onClick={() => setPinned((value) => !value)}
            aria-label={pinned ? e.unpin : e.pin}
            className="mo-press inline-flex size-11 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
          >
            {pinned ? (
              <PinOff aria-hidden="true" className="size-4" />
            ) : (
              <Pin aria-hidden="true" className="size-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setDeleting(true)}
            aria-label={e.delete}
            className="mo-press inline-flex size-11 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
      {actionError && <FieldError>{actionError}</FieldError>}

      <div className="mt-3">
        <label htmlFor="note-tags" className="block text-sm font-medium text-ink">
          {e.tags}
        </label>
        <input
          id="note-tags"
          value={tagsText}
          onChange={(event) => setTagsText(event.target.value)}
          autoComplete="off"
          aria-describedby="note-tags-hint"
          className="mt-1.5 min-h-11 w-full rounded-control border border-control-edge bg-sheet px-3 text-base text-ink transition-shadow duration-[var(--t-med)] focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] focus:outline-none"
        />
        <p id="note-tags-hint" className="mt-1 text-sm text-ink-muted">
          {e.tagsHint}
        </p>
      </div>

      <div
        role="toolbar"
        aria-label={e.insert}
        className="mt-5 flex flex-wrap items-center gap-1.5"
      >
        <span className="mr-1 text-sm font-medium text-ink-muted">{e.insert}:</span>
        {TEMPLATE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => insert(key)}
            className="mo-press inline-flex min-h-11 items-center rounded-pill border border-line-warm px-3.5 text-sm text-ink-secondary hover:bg-paper hover:text-ink"
          >
            {m.notes.insertItems[key]}
          </button>
        ))}
      </div>

      <div className="mt-4 lg:hidden">
        <Segmented
          legend={e.editorView}
          options={[
            { value: 'write', label: e.write },
            { value: 'preview', label: e.preview },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className={view === 'write' ? 'block' : 'hidden lg:block'}>
          <label htmlFor="note-text" className="sr-only">
            {e.text}
          </label>
          <textarea
            id="note-text"
            ref={textarea}
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
            maxLength={MAX_CHARACTERS}
            spellCheck
            aria-describedby="note-text-hint"
            className="min-h-[24rem] w-full resize-y rounded-box border border-control-edge bg-sheet p-4 font-mono text-base leading-relaxed text-ink transition-shadow duration-[var(--t-med)] focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] focus:outline-none lg:min-h-[32rem]"
          />
          <p id="note-text-hint" className="mt-1 text-sm text-ink-muted">
            {e.textHint}
          </p>
        </div>
        <section
          className={`${view === 'preview' ? 'block' : 'hidden lg:block'} min-w-0 rounded-box border border-line-warm p-4`}
          aria-label={e.preview}
        >
          {markdown.trim() === '' ? (
            <p className="text-ink-muted">{e.previewEmpty}</p>
          ) : (
            <Markdown text={markdown} />
          )}
        </section>
      </div>

      {deleting && (
        <ConfirmDialog
          title={format(m.notes.deleteTitle, { name: note.title })}
          description={m.notes.deleteBody}
          confirmLabel={m.common.delete}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(false)}
        />
      )}
    </Sheet>
  );
}
