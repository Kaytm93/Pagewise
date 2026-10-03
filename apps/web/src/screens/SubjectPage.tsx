import { ArrowLeft } from 'lucide-react';
import { messages as m } from '../i18n';
import { Link } from '../ui/Link';
import { Sheet } from '../ui/Sheet';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { NotFoundPage } from './NotFoundPage';
import { subjectMeta } from './subject-meta';

export function SubjectPage({ subjectId, groupId }: { subjectId: string; groupId: string | null }) {
  const { subjects } = useWorkspace();
  const subject = subjects.find((entry) => entry.id === subjectId);
  const group = groupId ? subject?.groups.find((entry) => entry.id === groupId) : undefined;
  if (!subject || (groupId && !group)) return <NotFoundPage />;

  const meta = group ? (group.kind ?? '') : subjectMeta(subject);
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
      <h1 className="font-heading text-3xl tracking-tight text-balance sm:text-title">
        {group ? group.name : subject.name}
      </h1>
      {meta && <p className="mt-1 text-meta text-ink-muted">{meta}</p>}

      <section className="mt-8 border-t border-line pt-6" aria-labelledby="chats-heading">
        <h2 id="chats-heading" className="text-meta font-medium text-ink-muted">
          {m.subject.chats}
        </h2>
        <div className="mt-3 rounded-box bg-paper p-4">
          <p className="font-medium">{m.subject.noChatsTitle}</p>
          <p className="mt-1 text-sm text-ink-secondary">{m.subject.noChatsHint}</p>
        </div>
      </section>
    </Sheet>
  );
}
