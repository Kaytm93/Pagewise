import { messages as m } from '../i18n';
import { Link } from '../ui/Link';
import { Sheet } from '../ui/Sheet';
import { SubjectIcon } from '../ui/SubjectIcon';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { groupCount, subjectMeta } from './subject-meta';

export function HomePage() {
  const { subjects } = useWorkspace();

  if (subjects.length === 0) {
    return (
      <Sheet>
        <h1 className="font-heading text-3xl tracking-tight text-balance sm:text-title">
          {m.home.emptyTitle}
        </h1>
        <p className="mt-3 max-w-prose text-ink-secondary">{m.home.emptyLead}</p>
      </Sheet>
    );
  }

  return (
    <Sheet>
      <h1 className="font-heading text-3xl tracking-tight text-balance sm:text-title">
        {m.home.title}
      </h1>
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {subjects.map((subject) => {
          const meta = subjectMeta(subject);
          return (
            <li key={subject.id}>
              <Link
                to={{ name: 'subject', subjectId: subject.id, groupId: null }}
                className="-mx-3 flex min-h-14 items-center gap-3 rounded-box px-3 py-3 text-ink no-underline hover:bg-paper"
              >
                <SubjectIcon icon={subject.icon} className="size-5 shrink-0 text-ink-secondary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{subject.name}</span>
                  {meta && <span className="block truncate text-meta text-ink-muted">{meta}</span>}
                </span>
                {subject.groups.length > 0 && (
                  <span className="hidden shrink-0 text-meta text-ink-muted sm:block">
                    {groupCount(subject.groups.length)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
