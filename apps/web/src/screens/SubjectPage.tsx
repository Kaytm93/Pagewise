import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import type { Group } from '../api/types';
import { format, messages as m } from '../i18n';
import { UpcomingExams } from '../planning/UpcomingExams';
import { navigate } from '../router';
import { Button } from '../ui/Button';
import { Link } from '../ui/Link';
import { Sheet } from '../ui/Sheet';
import { SubjectIcon } from '../ui/SubjectIcon';
import { listRow, sectionTitle } from '../ui/styles';
import { Tabs } from '../ui/Tabs';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { ChatList } from './chat/ChatList';
import { SubjectModel } from './chat/SubjectModel';
import { GroupDialog } from './GroupDialog';
import { NotFoundPage } from './NotFoundPage';
import { NoteList } from './notes/NoteList';
import { PromptRow } from './prompts/PromptRow';
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
  const [dialog, setDialog] = useState<Dialog>(null);
  const subject = findSubject(subjectId);
  const group = groupId ? subject?.groups.find((entry) => entry.id === groupId) : undefined;
  if (!subject || (groupId && !group)) return <NotFoundPage />;

  // Das eingebaute Fach „Standard“ lässt sich weder umbenennen noch löschen: kein „Bearbeiten“, dafür ein Hinweis.
  const builtin = subject.kind === 'default';
  const meta = group ? (group.kind ?? '') : builtin ? m.defaultSubject.lead : subjectMeta(subject);
  const close = () => setDialog(null);

  return (
    <Sheet width="wide">
      <span aria-hidden="true" className="lg-tape top-5 left-5 [--r:-1.8deg] md:left-11" />
      {!builtin && (
        <SubjectIcon
          icon={subject.icon}
          strokeWidth={0.4}
          className="lg-motif top-8 right-5 size-[84px] opacity-80 md:right-12 md:size-[132px]"
        />
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
      <div className="relative mt-6 flex items-start justify-between gap-4 pr-24 md:pr-40">
        <div className="min-w-0">
          <h1 className="mo-rise font-heading text-[clamp(40px,6.4vw,64px)] leading-none tracking-[-0.035em] text-balance break-words">
            {group ? group.name : subject.name}
          </h1>
          {meta && <p className="mo-rise mo-i-1 mt-3 text-ink-muted">{meta}</p>}
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

      {!group && (
        <section className="mt-10 border-t border-line-warm pt-6" aria-labelledby="groups-heading">
          <div className="flex items-center justify-between gap-4">
            <h2 id="groups-heading" className={sectionTitle}>
              {m.subject.groups}
            </h2>
            <Button variant="ghost" className="-mr-3" onClick={() => setDialog({ type: 'group' })}>
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

      <section className="mt-10 border-t border-line-warm pt-6">
        <Tabs
          label={m.notes.tabs}
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
            tab === 'notes' ? (
              <NoteList
                key={`${subject.id}/${group?.id ?? ''}`}
                subjectId={subject.id}
                groupId={group?.id ?? null}
              />
            ) : (
              <ChatList
                key={`${subject.id}/${group?.id ?? ''}`}
                subjectId={subject.id}
                groupId={group?.id ?? null}
              />
            )
          }
        />
      </section>

      {dialog?.type === 'subject' && !builtin && (
        <SubjectDialog subject={subject} onClose={close} />
      )}
      {dialog?.type === 'group' && (
        <GroupDialog subject={subject} group={dialog.group} onClose={close} />
      )}
    </Sheet>
  );
}
