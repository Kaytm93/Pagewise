import { ChevronRight, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SubjectCatalog, SubjectTemplate } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { FieldError } from '../../ui/FieldError';
import { foldName } from '../../ui/fold';
import { SubjectIcon } from '../../ui/SubjectIcon';
import { type TemplateResult, useWorkspace } from '../../workspace/WorkspaceProvider';
import { commonErrorMessage } from '../auth-errors';

/** Eindeutige Kennung einer Vorlage in der Auswahl (Vorlagen im alten Format haben keinen Schlüssel). */
const idOf = (template: SubjectTemplate) => template.key ?? `name:${template.name}`;

/** Vorlagen ohne Kategorie (alter Katalog) landen in einer Gruppe am Ende. */
const OTHER = '__other';

interface Group {
  id: string;
  name: string;
  entries: SubjectTemplate[];
}

function matches(template: SubjectTemplate, query: string): boolean {
  if (query === '') return true;
  return [template.name, ...template.aliases].some((text) => foldName(text).includes(query));
}

function buildGroups(catalog: SubjectCatalog, query: string): Group[] {
  const groups: Group[] = catalog.categories.map((category) => ({
    id: category.id,
    name: category.name,
    entries: [],
  }));
  const other: Group = { id: OTHER, name: m.templatePicker.otherCategory, entries: [] };
  for (const template of catalog.subjects) {
    if (!matches(template, query)) continue;
    (groups.find((group) => group.id === template.category) ?? other).entries.push(template);
  }
  return [...groups, other].filter((group) => group.entries.length > 0);
}

/**
 * Fächer aus dem Katalog der Vorlagen wählen: Suche (auch über andere Fachnamen wie „Erdkunde“),
 * Kategorien zum Auf- und Zuklappen, Mehrfachauswahl. Bereits angelegte Fächer sind markiert und nicht
 * wählbar. Es werden nur Namen angelegt, nie Lehrkräfte, Stunden oder Prompts (die Standard-Prompts
 * gelten automatisch, siehe D-034).
 */
export function TemplatePicker({
  onDone,
  onCustom,
  scroll = false,
  autoFocus = false,
}: {
  /** Nach dem Anlegen, auch wenn nichts Neues dabei war. */
  onDone?: (result: TemplateResult) => void;
  /** Das Gesuchte steht nicht im Katalog: der Nutzer möchte es als eigenes Fach anlegen. */
  onCustom?: (name: string) => void;
  /** Die Liste scrollt in einem begrenzten Bereich (in Dialogen), sonst wächst sie mit der Seite. */
  scroll?: boolean;
  /** Fokus beim Erscheinen auf die Suche (in Dialogen). Das Modal fokussiert nur, was beim Öffnen schon da ist. */
  autoFocus?: boolean;
}) {
  const { api } = useSession();
  const { subjects, addTemplateSubjects } = useWorkspace();
  const [catalog, setCatalog] = useState<SubjectCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const t = m.templatePicker;

  useEffect(() => {
    if (autoFocus) searchRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    let cancelled = false;
    api
      .subjectTemplates()
      .then((reply) => {
        if (!cancelled) setCatalog(reply);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setCatalog({ categories: [], subjects: [] });
        setLoadError(commonErrorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const folded = foldName(query);
  const groups = useMemo(() => (catalog ? buildGroups(catalog, folded) : []), [catalog, folded]);

  // Schon angelegt: gleicher Name (ohne Beachtung von Groß- und Kleinschreibung und Umlauten) oder
  // aus derselben Vorlage entstanden (auch wenn das Fach später umbenannt wurde).
  const existing = useMemo(
    () => ({
      names: new Set(subjects.map((subject) => foldName(subject.name))),
      keys: new Set(
        subjects.flatMap((subject) => (subject.templateKey ? [subject.templateKey] : [])),
      ),
    }),
    [subjects],
  );
  const taken = (template: SubjectTemplate) =>
    existing.names.has(foldName(template.name)) ||
    (template.key !== null && existing.keys.has(template.key));

  const data: SubjectCatalog = catalog ?? { categories: [], subjects: [] };
  const loading = catalog === null;

  // Ohne Suche ist nur die erste Gruppe offen, dazu jede mit einer Auswahl. Bei einer Suche sind alle Treffer offen.
  const isOpen = (group: Group, index: number) => {
    if (folded !== '') return true;
    if (open) return open.has(group.id);
    return index === 0 || group.entries.some((template) => chosen.has(idOf(template)));
  };
  const toggleGroup = (group: Group) =>
    setOpen((current) => {
      const next = new Set(
        current ?? groups.flatMap((entry, position) => (isOpen(entry, position) ? [entry.id] : [])),
      );
      if (!next.delete(group.id)) next.add(group.id);
      return next;
    });

  const toggleTemplate = (template: SubjectTemplate, checked: boolean) => {
    setNotice(null);
    setChosen((current) => {
      const next = new Set(current);
      if (checked) next.add(idOf(template));
      else next.delete(idOf(template));
      return next;
    });
  };

  async function submit() {
    if (!catalog) return;
    const picked = catalog.subjects.filter((template) => chosen.has(idOf(template)));
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await addTemplateSubjects(picked);
      setChosen(new Set());
      setNotice(
        result.created.length === 1
          ? t.createdOne
          : format(t.createdMany, { count: result.created.length }),
      );
      onDone?.(result);
    } catch (caught) {
      setError(commonErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const exactMatch = data.subjects.some((template) => foldName(template.name) === folded);
  const showCustom = onCustom !== undefined && query.trim() !== '' && !exactMatch;

  return (
    <div>
      <label htmlFor={searchId} className="text-sm font-medium text-ink">
        {t.searchLabel}
      </label>
      <input
        id={searchId}
        ref={searchRef}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t.searchPlaceholder}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={80}
        className="mt-1.5 block min-h-11 w-full rounded-control border border-control-edge bg-sheet px-3 text-ink placeholder:text-ink-muted"
      />

      {loadError && <FieldError>{loadError}</FieldError>}
      {loading && (
        <p role="status" className="mt-3 text-ink-muted">
          {t.loading}
        </p>
      )}
      {!loading && data.subjects.length === 0 && !loadError && (
        <p className="mt-3 text-ink-muted">{t.none}</p>
      )}

      <div
        className={`mt-3 ${scroll ? 'max-h-[45dvh] overflow-y-auto overscroll-contain pr-1' : ''}`}
      >
        {folded !== '' && groups.length === 0 && data.subjects.length > 0 && (
          <p className="py-2 text-ink-secondary">{t.noMatches}</p>
        )}
        {groups.map((group, index) => {
          const expanded = isOpen(group, index);
          const panelId = `${searchId}-${group.id}`;
          const count = group.entries.filter((template) => chosen.has(idOf(template))).length;
          return (
            <section key={group.id} className="border-b border-line last:border-b-0">
              <h3>
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  disabled={folded !== ''}
                  className="flex min-h-11 w-full items-center gap-2 rounded-control px-1 text-left font-medium text-ink hover:bg-paper disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={`size-4 shrink-0 text-ink-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
                  />
                  <span className="flex-1">{group.name}</span>
                  <span className="text-meta font-normal text-ink-muted">
                    {count > 0
                      ? format(t.groupSelected, { count, total: group.entries.length })
                      : group.entries.length}
                  </span>
                </button>
              </h3>
              {expanded && (
                <ul id={panelId} className="pb-1">
                  {group.entries.map((template) => {
                    const isTaken = taken(template);
                    const id = `${searchId}-${idOf(template)}`;
                    // Gefunden über einen anderen Namen? Dann zeigen wir, über welchen.
                    const alias =
                      folded !== '' && !foldName(template.name).includes(folded)
                        ? template.aliases.find((entry) => foldName(entry).includes(folded))
                        : undefined;
                    return (
                      <li key={idOf(template)}>
                        <label
                          htmlFor={id}
                          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-1 py-1.5 hover:bg-paper has-[:disabled]:cursor-default has-[:disabled]:text-ink-muted has-[:disabled]:hover:bg-transparent"
                        >
                          <input
                            id={id}
                            type="checkbox"
                            className="size-5 shrink-0 accent-primary"
                            disabled={isTaken || busy}
                            checked={isTaken || chosen.has(idOf(template))}
                            onChange={(event) => toggleTemplate(template, event.target.checked)}
                          />
                          <SubjectIcon
                            icon={template.icon}
                            className="size-[18px] shrink-0 text-ink-secondary"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{template.name}</span>
                            {alias && (
                              <span className="block truncate text-meta text-ink-muted">
                                {format(t.alsoKnownAs, { name: alias })}
                              </span>
                            )}
                          </span>
                          {isTaken && <span className="text-meta text-ink-muted">{t.exists}</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
        {showCustom && (
          <button
            type="button"
            onClick={() => onCustom?.(query.trim())}
            className="mt-2 flex min-h-11 w-full items-center gap-2.5 rounded-control px-1 text-left text-ink hover:bg-paper"
          >
            <Plus aria-hidden="true" strokeWidth={1.6} className="size-[18px] shrink-0" />
            {format(t.createCustom, { name: query.trim() })}
          </button>
        )}
      </div>

      {error && <FieldError>{error}</FieldError>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          busy={busy}
          disabled={chosen.size === 0}
          onClick={() => void submit()}
        >
          {chosen.size === 0
            ? t.submitNone
            : chosen.size === 1
              ? t.submitOne
              : format(t.submitMany, { count: chosen.size })}
        </Button>
        <p role="status" className="text-sm text-ink-secondary">
          {notice ?? (chosen.size > 0 ? format(t.selected, { count: chosen.size }) : '')}
        </p>
      </div>
    </div>
  );
}
