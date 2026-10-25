import { Check, Pencil, Plus } from 'lucide-react';
import type { Subject } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { formatDate, localDate } from '../../planning/dates';
import { relativeDay } from '../../planning/labels';
import { usePlanner } from '../../planning/PlannerProvider';
import { groupExams } from '../../planning/schedule';
import { Button } from '../../ui/Button';
import { Link } from '../../ui/Link';
import { sectionTitle } from '../../ui/styles';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { describeSelection, engineName } from '../chat/models';
import { groupCount, subjectMeta } from '../subject-meta';
import { SubjectMotifs } from './SubjectMotifs';

/*
 * Die Fachseite als „Arbeitsplatz“ in der Richtung „Atelier“ (Mockup B): Kopf mit großem Fachmotiv, Ledger
 * (eine Tabelle mit den Kennzahlen des Fachs), Untergruppen als Kacheln, die zugleich Filter sind. Alles hier
 * zeigt nur, was die Seite schon hat (Fach, Arbeitsbereich, Planer); eine eigene Serverabfrage gibt es nicht.
 * Die Stile stehen in `styles/atelier-fach.css`, nirgends ein Inline-Style.
 */

/** Kopf: Fachname als H1 (Größe aus `--subject-h1`), Angaben zum Fach, „Bearbeiten“; rechts das gezeichnete Motiv. */
export function SubjectAtelierHead({ subject, onEdit }: { subject: Subject; onEdit: () => void }) {
  // Das eingebaute Fach „Standard“ lässt sich weder umbenennen noch löschen: kein „Bearbeiten“, dafür sein Hinweis.
  const builtin = subject.kind === 'default';
  const meta = builtin ? m.defaultSubject.lead : subjectMeta(subject);
  return (
    <header className="at-head relative mt-6">
      {!builtin && <SubjectMotifs kind={subject.icon} className="lg-motif at-motif" />}
      <div className="at-head-text min-w-0">
        {/* Wie in den anderen Richtungen: `lang="de"` und `hyphens-auto` trennen lange Fachnamen mit Trennstrich. */}
        <h1
          lang="de"
          className="mo-rise font-heading hyphens-auto text-[length:var(--subject-h1)] leading-none tracking-[-0.035em] text-balance break-words"
        >
          {subject.name}
        </h1>
        {meta && <p className="mo-rise mo-i-1 mt-3 text-ink-muted break-words">{meta}</p>}
        {!builtin && (
          <Button variant="secondary" className="mt-5" onClick={onEdit}>
            <Pencil aria-hidden="true" className="size-4" />
            {m.common.edit}
          </Button>
        )}
      </div>
    </header>
  );
}

/**
 * Ledger: Modell, Untergruppen und der nächste Test. Wie viele Chats und Hefteinträge es gibt, weiß diese Seite
 * nicht (die Listen laden selbst) und der Server hat dafür keine Zählung; diese Zeilen fehlen darum.
 * Der Test erscheint erst, wenn der Planer geladen ist.
 */
export function SubjectAtelierLedger({ subject }: { subject: Subject }) {
  const { providers, modelSettings, engines } = useWorkspace();
  const { status, exams, now } = usePlanner();
  const t = m.atelierFach;
  const builtin = subject.kind === 'default';

  const ownEngine = engineName(engines.profiles, subject.engineProfileId);
  const own = describeSelection(providers, subject.model);
  const standard = describeSelection(providers, modelSettings.default);
  let summary: string;
  if (ownEngine) summary = format(m.subject.agentOwn, { name: ownEngine });
  else if (own) summary = format(m.subject.modelOwn, { name: own });
  else if (standard) summary = format(m.subject.modelDefault, { name: standard });
  else summary = m.subject.modelNone;

  const today = localDate(now);
  const next =
    !builtin && status === 'ready'
      ? groupExams(
          exams.filter((exam) => exam.subjectId === subject.id),
          today,
        ).upcoming[0]
      : undefined;

  return (
    <dl className="at-ledger mo-rise mo-i-2" aria-label={t.ledger}>
      <div className="at-ledger-row">
        <dt>{m.subject.model}</dt>
        <dd>
          <span className="at-ledger-value">{summary}</span>
          {/* Führt zum Modell-Abschnitt weiter unten (wie der Chip in „Lagen“). */}
          <a className="at-ledger-link" href="#model-heading">
            {m.subject.modelChange}
          </a>
        </dd>
      </div>
      <div className="at-ledger-row">
        <dt>{m.subject.groups}</dt>
        <dd>
          <span className="at-ledger-value">{groupCount(subject.groups.length)}</span>
        </dd>
      </div>
      {!builtin && status === 'ready' && (
        <div className="at-ledger-row">
          <dt>{t.nextExam}</dt>
          <dd>
            {next ? (
              <>
                <span className="at-ledger-value">
                  {next.title ? `${next.kind}: ${next.title}` : next.kind}
                </span>
                <span className="at-ledger-sub">
                  {relativeDay(next.date, today)} · {formatDate(next.date, 'short')}
                </span>
              </>
            ) : (
              <span className="at-ledger-value at-ledger-quiet">{t.noExam}</span>
            )}
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * Untergruppen als Kacheln. Jede Kachel ist ein Schalter (`aria-pressed`): gewählt zeigen Chats und
 * Hefteinträge darunter nur diese Untergruppe, noch einmal gewählt hebt den Filter auf. Daneben bleiben
 * „Öffnen“ (die Seite der Untergruppe) und „Bearbeiten“, damit nichts verloren geht, was die Liste der
 * anderen Richtungen kann. Alle Flächen sind mindestens 44 px hoch.
 */
export function SubjectAtelierTiles({
  subject,
  active,
  onToggle,
  onAdd,
  onEdit,
}: {
  subject: Subject;
  /** Kennung der gewählten Untergruppe, sonst `null`. */
  active: string | null;
  onToggle: (groupId: string) => void;
  onAdd: () => void;
  onEdit: (groupId: string) => void;
}) {
  const t = m.atelierFach;
  return (
    <section className="at-groups mt-10" aria-labelledby="groups-heading">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="groups-heading" className={sectionTitle}>
          {m.subject.groups}
        </h2>
        <Button variant="ghost" className="-mr-3 shrink-0 whitespace-nowrap" onClick={onAdd}>
          <Plus aria-hidden="true" className="size-4" />
          {m.subject.addGroup}
        </Button>
      </div>
      {subject.groups.length === 0 ? (
        <div className="mt-2 rounded-box bg-paper p-4">
          <p className="font-medium">{m.subject.noGroupsTitle}</p>
          <p className="mt-1 text-sm text-ink-secondary">{m.subject.noGroupsHint}</p>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-muted">{t.groupsLead}</p>
          <ul className="at-tiles mo-rise mo-i-3" aria-label={t.tilesLabel}>
            {subject.groups.map((entry) => {
              const pressed = entry.id === active;
              return (
                <li key={entry.id} className="at-tile" data-pressed={pressed || undefined}>
                  <button
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => onToggle(entry.id)}
                    className="at-tile-main mo-press"
                  >
                    <span className="at-tile-name">{entry.name}</span>
                    {entry.kind && <span className="at-tile-kind">{entry.kind}</span>}
                    {/* Nur zur Anschauung: Hilfsmittel lesen den Zustand aus `aria-pressed`. */}
                    <span aria-hidden="true" className="at-tile-go">
                      {pressed && <Check className="size-4" />}
                      {pressed ? t.filterOn : t.filterOff}
                    </span>
                  </button>
                  <div className="at-tile-actions">
                    <Link
                      to={{ name: 'subject', subjectId: subject.id, groupId: entry.id }}
                      aria-label={format(t.openGroupNamed, { name: entry.name })}
                      className="at-tile-open"
                    >
                      {t.openGroup}
                    </Link>
                    <button
                      type="button"
                      onClick={() => onEdit(entry.id)}
                      aria-label={format(m.subject.editGroupNamed, { name: entry.name })}
                      className="at-tile-edit mo-press"
                    >
                      <Pencil aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/** Hinweis über der Liste, solange ein Filter gilt, mit dem Knopf zum Aufheben. */
export function SubjectAtelierFilterNote({ name, onClear }: { name: string; onClear: () => void }) {
  return (
    <div className="at-filter-note">
      <span role="status">{format(m.atelierFach.filterNote, { name })}</span>
      <button type="button" className="at-filter-clear mo-press" onClick={onClear}>
        {m.atelierFach.filterClear}
      </button>
    </div>
  );
}
