import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import type { Group } from '../api/types';
import { format, messages as m } from '../i18n';
import { Button } from '../ui/Button';
import { Link } from '../ui/Link';
import { Sheet } from '../ui/Sheet';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { GroupDialog } from './GroupDialog';
import { NotFoundPage } from './NotFoundPage';
import { PromptRow } from './prompts/PromptRow';
import { SubjectDialog } from './SubjectDialog';
import { subjectMeta } from './subject-meta';

type Dialog = { type: 'subject' } | { type: 'group'; group?: Group } | null;

export function SubjectPage({ subjectId, groupId }: { subjectId: string; groupId: string | null }) {
  const { subjects } = useWorkspace();
  const [dialog, setDialog] = useState<Dialog>(null);
  const subject = subjects.find((entry) => entry.id === subjectId);
  const group = groupId ? subject?.groups.find((entry) => entry.id === groupId) : undefined;
  if (!subject || (groupId && !group)) return <NotFoundPage />;

  const meta = group ? (group.kind ?? '') : subjectMeta(subject);
  const close = () => setDialog(null);

  return (
    <Sheet>
      {group && (
        <Link
          to={{ name: 'subject', subjectId: subject.id, groupId: null }}
          className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {subject.name}
        </Link>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-3xl tracking-tight text-balance break-words sm:text-title">
            {group ? group.name : subject.name}
          </h1>
          {meta && <p className="mt-1 text-meta text-ink-muted">{meta}</p>}
        </div>
        <Button
          variant="secondary"
          className="shrink-0"
          onClick={() => setDialog(group ? { type: 'group', group } : { type: 'subject' })}
        >
          <Pencil aria-hidden="true" className="size-4" />
          {m.common.edit}
        </Button>
      </div>

      {!group && (
        <section className="mt-8 border-t border-line pt-6" aria-labelledby="groups-heading">
          <div className="flex items-center justify-between gap-4">
            <h2 id="groups-heading" className="text-meta font-medium text-ink-muted">
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
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {subject.groups.map((entry) => (
                <li key={entry.id} className="flex items-center">
                  <Link
                    to={{ name: 'subject', subjectId: subject.id, groupId: entry.id }}
                    className="-ml-3 flex min-h-14 min-w-0 flex-1 flex-col justify-center rounded-box px-3 py-2 text-ink no-underline hover:bg-paper"
                  >
                    <span className="truncate font-medium">{entry.name}</span>
                    {entry.kind && (
                      <span className="truncate text-meta text-ink-muted">{entry.kind}</span>
                    )}
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDialog({ type: 'group', group: entry })}
                    aria-label={format(m.subject.editGroupNamed, { name: entry.name })}
                    className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-8 border-t border-line pt-6" aria-labelledby="prompt-heading">
        <h2 id="prompt-heading" className="text-meta font-medium text-ink-muted">
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

      <section className="mt-8 border-t border-line pt-6" aria-labelledby="chats-heading">
        <h2 id="chats-heading" className="text-meta font-medium text-ink-muted">
          {m.subject.chats}
        </h2>
        <div className="mt-3 rounded-box bg-paper p-4">
          <p className="font-medium">{m.subject.noChatsTitle}</p>
          <p className="mt-1 text-sm text-ink-secondary">{m.subject.noChatsHint}</p>
        </div>
      </section>

      {dialog?.type === 'subject' && <SubjectDialog subject={subject} onClose={close} />}
      {dialog?.type === 'group' && (
        <GroupDialog subject={subject} group={dialog.group} onClose={close} />
      )}
    </Sheet>
  );
}
