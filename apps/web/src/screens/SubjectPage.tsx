import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Group } from '../api/types';
import { format, messages as m } from '../i18n';
import { UpcomingExams } from '../planning/UpcomingExams';
import { navigate, pageKey } from '../router';
import { Button } from '../ui/Button';
import { Link } from '../ui/Link';
import { Sheet } from '../ui/Sheet';
import { SubjectIcon } from '../ui/SubjectIcon';
import { listRow, sectionTitle } from '../ui/styles';
import { Tabs } from '../ui/Tabs';
import { useDesign } from '../ui/useDesign';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import {
  SubjectAtelierFilterNote,
  SubjectAtelierHead,
  SubjectAtelierLedger,
  SubjectAtelierTiles,
} from './atelier/SubjectAtelier';
import { SubjectMotifs } from './atelier/SubjectMotifs';
import { ChatList } from './chat/ChatList';
import { SubjectModel } from './chat/SubjectModel';
import { GroupDialog } from './GroupDialog';
import { SubjectHead } from './lagen/SubjectHead';
import { NotFoundPage } from './NotFoundPage';
import { NoteList } from './notes/NoteList';
import { PromptRow } from './prompts/PromptRow';
import { SheetRegister, SubjectRings } from './raum/SubjectFrame';
import { SubjectDialog } from './SubjectDialog';
import { subjectMeta } from './subject-meta';

type Dialog = { type: 'subject' } | { type: 'group'; group?: Group } | null;

export function SubjectPage({
  subjectId,
  groupId,
  tab,
}: {
  subjectId: string;
  groupId: string | null;
  tab?: 'notes';
}) {
  const { findSubject } = useWorkspace();
  const design = useDesign();
  const lagen = design === 'lagen';
  const atelier = design === 'atelier';
  const raum = design === 'raum';
  const [dialog, setDialog] = useState<Dialog>(null);
  // „Atelier“: die gewählte Untergruppe als Filter für Chats und Hefteinträge (nur dort, nur auf der Fachseite).
  const [filter, setFilter] = useState<{ subjectId: string; groupId: string } | null>(null);
  // Rückweg aus dem Hefteintrags-Editor (M4-T017): NotePage markiert beim Verlassen seinen Chronik-Eintrag
  // als „kehrt zu den Hefteinträgen zurück“; hier wird die Markierung aufgesucht. Nur dieser eine Rückweg
  // bekommt die Liste in den Blick — kein anderes Zurück (Seitenleiste, Zurück-Knopf des Browsers).
  const zielSchluessel = pageKey({ name: 'subject', subjectId, groupId, tab: 'notes' });
  const absprung = `pagewise.rueck.${zielSchluessel}`;
  const listenRuf = `pagewise.ul-focus.${zielSchluessel}`;
  const zielRef = useRef<HTMLElement | null>(null);
  const rueckkehrZiel = useRef(false);
  // Vor dem Bildlauf nach oben (router.ts, M4-T004): Markierung aufnehmen, wenn der Editor gerade die
  // Liste als Rückweg gewählt hat.
  useLayoutEffect(() => {
    if (sessionStorage.getItem(absprung) !== 'notes') return;
    sessionStorage.removeItem(absprung);
    rueckkehrZiel.current = true;
  }, [absprung]);
  // Nach dem Bildlauf nach oben (router.ts, M4-T004): Reiter „Hefteinträge“ in den Blick holen. Die
  // Liste nimmt den Fokus selbst (NoteList liest den Ruf, sobald sie steht); verwaiste Rufe aus einem
  // anderen Reiter räumt SubjectPage hier ab, solange das Hefteintrags-Panel nicht offen ist.
  useEffect(() => {
    if (!rueckkehrZiel.current) return;
    zielRef.current?.scrollIntoView({ block: 'nearest' });
    const panelOffen = document.querySelector('[aria-label="Hefteinträge"]') !== null;
    if (window.sessionStorage.getItem(listenRuf) === '1' && !panelOffen) {
      window.sessionStorage.removeItem(listenRuf);
    }
  });
  const subject = findSubject(subjectId);
  const group = groupId ? subject?.groups.find((entry) => entry.id === groupId) : undefined;
  if (!subject || (groupId && !group)) return <NotFoundPage />;

  // Das eingebaute Fach „Standard“ lässt sich weder umbenennen noch löschen: kein „Bearbeiten“, dafür ein Hinweis.
  const builtin = subject.kind === 'default';
  const meta = group ? (group.kind ?? '') : builtin ? m.defaultSubject.lead : subjectMeta(subject);
  const close = () => setDialog(null);
  // „Atelier“ zeigt die Fachseite als Arbeitsplatz (Kopf, Ledger, Kacheln, dann Chats); die Seite einer
  // Untergruppe behält den gemeinsamen Aufbau. Ein Filter gilt nur für dieses Fach und nur, solange es die
  // Untergruppe noch gibt.
  const arbeitsplatz = atelier && !group;
  const filterGroup =
    arbeitsplatz && filter?.subjectId === subject.id
      ? subject.groups.find((entry) => entry.id === filter.groupId)
      : undefined;
  const listGroupId = group?.id ?? filterGroup?.id ?? null;
  // Das Fachmotiv sitzt in allen Richtungen an derselben Stelle im Kopf; „Atelier“ zeichnet es selbst
  // (gestaffelte Linien), die anderen Richtungen behalten das bisherige Symbol.
  const motivKlasse = 'lg-motif top-8 right-5 size-[84px] opacity-80 md:right-12 md:size-[132px]';

  const einstellungen = (
    <>
      <section className="mt-10 border-t border-line-warm pt-6" aria-labelledby="prompt-heading">
        <h2 id="prompt-heading" className={sectionTitle}>
          {m.prompts.title}
        </h2>
        <div className="mt-3">
          <PromptRow
            scope={group ? { type: 'group', id: group.id } : { type: 'subject', id: subject.id }}
            layer={group ? 'group' : 'subject'}
            preview={{ subjectId: subject.id, groupId: group?.id ?? null }}
          />
        </div>
      </section>

      {!group && <SubjectModel subject={subject} />}

      {!group && !builtin && <UpcomingExams subjectId={subject.id} />}
    </>
  );

  const werkbereich = (
    <section
      ref={zielRef}
      id="hefte-eintraege-bereich"
      className="mt-10 border-t border-line-warm pt-6 scroll-mt-20"
    >
      <Tabs
        label={m.notes.tabs}
        className={lagen ? 'lg-register' : undefined}
        tabs={[
          { value: 'chats', label: m.notes.chats },
          { value: 'notes', label: m.notes.notes },
        ]}
        value={tab === 'notes' ? 'notes' : 'chats'}
        onChange={(next) =>
          navigate(
            {
              name: 'subject',
              subjectId: subject.id,
              groupId: group?.id ?? null,
              ...(next === 'notes' && { tab: 'notes' as const }),
            },
            { replace: true },
          )
        }
        panel={
          <>
            {filterGroup && (
              <SubjectAtelierFilterNote name={filterGroup.name} onClear={() => setFilter(null)} />
            )}
            {tab === 'notes' ? (
              <NoteList
                key={`${subject.id}/${listGroupId ?? ''}`}
                subjectId={subject.id}
                groupId={listGroupId}
              />
            ) : (
              <ChatList
                key={`${subject.id}/${listGroupId ?? ''}`}
                subjectId={subject.id}
                groupId={listGroupId}
              />
            )}
          </>
        }
      />
    </section>
  );

  return (
    <Sheet width="wide">
      {!lagen && (
        <>
          <span aria-hidden="true" className="lg-tape top-5 left-5 [--r:-1.8deg] md:left-11" />
          {/* „Raum“ legt zwei Ringe hinter das Fachmotiv — Zier, zusätzlich zum bisherigen Symbol. */}
          {raum && !builtin && <SubjectRings />}
          {!builtin &&
            !arbeitsplatz &&
            (atelier ? (
              <SubjectMotifs kind={subject.icon} className={motivKlasse} />
            ) : (
              <SubjectIcon icon={subject.icon} strokeWidth={0.4} className={motivKlasse} />
            ))}
          {/* Register am rechten Blattrand: dieselbe Wahl wie die Reiterleiste unten, aber nur Darstellung
              (aria-hidden, ohne Fokus, ohne Klick) — es schaltet nichts um. */}
          {raum && <SheetRegister active={tab === 'notes' ? 'notes' : 'chats'} />}
        </>
      )}
      {group && (
        <Link
          to={{ name: 'subject', subjectId: subject.id, groupId: null }}
          className="mo-press relative mt-6 mb-1 inline-flex min-h-11 items-center gap-1.5 text-sm"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {subject.name}
        </Link>
      )}
      {lagen ? (
        <SubjectHead
          subject={subject}
          group={group}
          onEdit={() => setDialog(group ? { type: 'group', group } : { type: 'subject' })}
        />
      ) : arbeitsplatz ? (
        <>
          <SubjectAtelierHead subject={subject} onEdit={() => setDialog({ type: 'subject' })} />
          <SubjectAtelierLedger subject={subject} />
        </>
      ) : (
        <>
          <div className="relative mt-6 flex items-start justify-between gap-4 pr-[88px] md:pr-40">
            <div className="min-w-0">
              {/* subject#06: Die Größe kommt aus `--subject-h1` (styles/screens.css, je Richtung): auf dem Telefon
                  klein, damit übliche Fächer einzeilig bleiben; lange Wörter trennt `hyphens-auto` mit Trennstrich
                  (Sprache „de“ kommt von <html lang="de">) statt mitten im Wort zu brechen. */}
              <h1
                lang="de"
                className="mo-rise font-heading hyphens-auto text-[length:var(--subject-h1)] leading-none tracking-[-0.035em] text-balance break-words"
              >
                {group ? group.name : subject.name}
              </h1>
              {meta && <p className="mo-rise mo-i-1 mt-3 text-ink-muted break-words">{meta}</p>}
            </div>
          </div>
          {(group || !builtin) && (
            <Button
              variant="secondary"
              className="mt-5"
              onClick={() => setDialog(group ? { type: 'group', group } : { type: 'subject' })}
            >
              <Pencil aria-hidden="true" className="size-4" />
              {m.common.edit}
            </Button>
          )}
        </>
      )}

      {arbeitsplatz && (
        <SubjectAtelierTiles
          subject={subject}
          active={filterGroup?.id ?? null}
          onToggle={(groupId) =>
            setFilter(filterGroup?.id === groupId ? null : { subjectId: subject.id, groupId })
          }
          onAdd={() => setDialog({ type: 'group' })}
          onEdit={(groupId) =>
            setDialog({
              type: 'group',
              group: subject.groups.find((entry) => entry.id === groupId),
            })
          }
        />
      )}

      {!group && !arbeitsplatz && (
        <section className="mt-10 border-t border-line-warm pt-6" aria-labelledby="groups-heading">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="groups-heading" className={sectionTitle}>
              {m.subject.groups}
            </h2>
            <Button
              variant="ghost"
              className="-mr-3 shrink-0 whitespace-nowrap"
              onClick={() => setDialog({ type: 'group' })}
            >
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
            <ul className="mt-2 divide-y divide-line-warm border-y border-line-warm">
              {subject.groups.map((entry) => (
                <li key={entry.id} className="flex items-center">
                  <Link
                    to={{ name: 'subject', subjectId: subject.id, groupId: entry.id }}
                    className={listRow}
                  >
                    <span className="truncate font-heading text-xl tracking-[-0.2px]">
                      {entry.name}
                    </span>
                    {entry.kind && (
                      <span className="truncate text-meta text-ink-muted">{entry.kind}</span>
                    )}
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDialog({ type: 'group', group: entry })}
                    aria-label={format(m.subject.editGroupNamed, { name: entry.name })}
                    className="mo-press -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink-muted hover:bg-paper hover:text-ink"
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* „Atelier“ stellt die Arbeit voran (Chats und Hefteinträge); Prompt, Modell und Tests folgen darunter. */}
      {arbeitsplatz ? (
        <>
          {werkbereich}
          {einstellungen}
        </>
      ) : (
        <>
          {einstellungen}
          {werkbereich}
        </>
      )}

      {dialog?.type === 'subject' && !builtin && (
        <SubjectDialog subject={subject} onClose={close} />
      )}
      {dialog?.type === 'group' && (
        <GroupDialog subject={subject} group={dialog.group} onClose={close} />
      )}
    </Sheet>
  );
}
