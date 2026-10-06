import { Plus } from 'lucide-react';
import { useState } from 'react';
import { messages as m } from '../i18n';
import { Button } from '../ui/Button';
import { Link } from '../ui/Link';
import { sectionTitle } from '../ui/styles';
import { localDate } from './dates';
import { ExamDialog } from './ExamDialog';
import { ExamRow } from './ExamsPage';
import { usePlanner } from './PlannerProvider';
import { groupExams } from './schedule';

/** Die nächsten Tests eines Fachs auf dessen Seite, mit „Test eintragen“ (das Fach ist vorgewählt). */
export function UpcomingExams({ subjectId }: { subjectId: string }) {
  const { status, exams, now } = usePlanner();
  const [adding, setAdding] = useState<{ exam?: (typeof exams)[number] } | null>(null);
  const t = m.planning.subjectExams;
  if (status === 'loading') return null;
  const today = localDate(now);
  const upcoming = groupExams(
    exams.filter((exam) => exam.subjectId === subjectId),
    today,
  ).upcoming;

  return (
    <section
      className="mt-10 border-t border-line-warm pt-6"
      aria-labelledby="subject-exams-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="subject-exams-heading" className={sectionTitle}>
          {t.title}
        </h2>
        <Button
          variant="ghost"
          className="-mr-3 shrink-0 whitespace-nowrap"
          onClick={() => setAdding({})}
        >
          <Plus aria-hidden="true" className="size-4" />
          {t.add}
        </Button>
      </div>
      {upcoming.length === 0 ? (
        <p className="mt-3 text-ink-muted">{t.none}</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-line-warm border-y border-line-warm">
            {upcoming.slice(0, 3).map((exam) => (
              <ExamRow key={exam.id} exam={exam} today={today} onOpen={() => setAdding({ exam })} />
            ))}
          </ul>
          <Link to={{ name: 'exams' }} className="mt-1 inline-flex min-h-11 items-center">
            {t.all}
          </Link>
        </>
      )}
      {adding && (
        <ExamDialog exam={adding.exam} subjectId={subjectId} onClose={() => setAdding(null)} />
      )}
    </section>
  );
}
