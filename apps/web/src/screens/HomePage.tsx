import { MessageCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { messages as m } from '../i18n';
import { navigate } from '../router';
import { Button } from '../ui/Button';
import { Link } from '../ui/Link';
import { Sheet } from '../ui/Sheet';
import { SubjectIcon } from '../ui/SubjectIcon';
import { subjectColorAttr } from '../ui/subject-color';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { AskForm } from './home/AskForm';
import { SubjectDialog } from './SubjectDialog';
import { groupCount, subjectMeta } from './subject-meta';

const dateFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

export function HomePage() {
  const { subjects } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const dialog = creating && <SubjectDialog onClose={() => setCreating(false)} />;

  if (subjects.length === 0) {
    return (
      <Sheet>
        <h1 className="font-heading text-[clamp(34px,6vw,52px)] leading-[1.1] tracking-[-0.025em] text-balance">
          {m.home.emptyTitle}
        </h1>
        <p className="mt-3 max-w-prose text-ink-secondary">{m.home.emptyLead}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setCreating(true)}>
            {m.subjectDialog.createTitle}
          </Button>
          <Button variant="secondary" onClick={() => navigate({ name: 'default-chat' })}>
            {m.home.startChat}
          </Button>
        </div>
        {dialog}
      </Sheet>
    );
  }

  return (
    <Sheet width="wide">
      <p className="mo-rise text-sm text-ink-muted">{dateFormat.format(new Date())}</p>
      <h1 className="mo-rise mo-i-1 mt-2.5 max-w-[760px] font-heading text-[clamp(34px,5.4vw,56px)] leading-[1.12] tracking-[-0.025em] text-balance">
        {m.home.heading}
      </h1>
      <div className="mo-rise mo-i-2">
        <AskForm />
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm text-ink-muted">
          {m.home.or}
          <Link
            to={{ name: 'default-chat' }}
            className="inline-flex min-h-11 items-center underline underline-offset-[3px]"
          >
            {m.home.openDefault}
          </Link>
        </p>
      </div>

      <section className="mo-rise mo-i-3 mt-12" aria-labelledby="home-subjects">
        <h2
          id="home-subjects"
          className="mb-3.5 font-sans text-[15px] font-medium tracking-[0.06em] text-ink-muted uppercase"
        >
          {m.home.title}
        </h2>
        <ul className="border-t border-line-warm">
          <li className="border-b border-line-warm">
            <Link
              to={{ name: 'default-chat' }}
              className="lg-row grid min-h-16 grid-cols-[auto_1fr_auto] items-center gap-4 rounded-[2px] px-2 py-3.5 text-ink no-underline"
            >
              <MessageCircle
                aria-hidden="true"
                strokeWidth={1.6}
                className="size-6 text-ink-secondary"
              />
              <span className="min-w-0">
                <span className="block truncate font-heading text-xl tracking-[-0.2px]">
                  {m.defaultSubject.homeTitle}
                </span>
                <span className="block truncate text-sm text-ink-muted">
                  {m.defaultSubject.homeHint}
                </span>
              </span>
            </Link>
          </li>
          {subjects.map((subject) => {
            const meta = subjectMeta(subject);
            return (
              <li
                key={subject.id}
                data-subj={subjectColorAttr(subject.color)}
                className="border-b border-line-warm"
              >
                <Link
                  to={{ name: 'subject', subjectId: subject.id, groupId: null }}
                  className="lg-row grid min-h-16 grid-cols-[auto_1fr_auto] items-center gap-4 rounded-[2px] px-2 py-3.5 text-ink no-underline"
                >
                  <SubjectIcon icon={subject.icon} className="size-6 text-ink-secondary" />
                  <span className="min-w-0">
                    <span className="block truncate font-heading text-xl tracking-[-0.2px]">
                      {subject.name}
                    </span>
                    {meta && <span className="block truncate text-sm text-ink-muted">{meta}</span>}
                  </span>
                  {subject.groups.length > 0 && (
                    <span className="hidden shrink-0 text-sm text-ink-muted sm:block">
                      {groupCount(subject.groups.length)}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
        <Button variant="ghost" className="mt-3 -ml-3" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" className="size-4" />
          {m.shell.addSubject}
        </Button>
      </section>
      {dialog}
    </Sheet>
  );
}
