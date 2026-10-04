import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { Exam } from '../api/types';
import { format, messages as m } from '../i18n';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { sectionTitle } from '../ui/styles';
import { subjectColorAttr } from '../ui/subject-color';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { localDate, monthShort } from './dates';
import { ExamDialog } from './ExamDialog';
import { relativeDay } from './labels';
import { usePlanner } from './PlannerProvider';
import { groupExams } from './schedule';

/** Eine Zeile der Liste: Datum, Art und Titel, Fach, Abstand zu heute. */
export function ExamRow({
  exam,
  today,
  onOpen,
}: {
  exam: Exam;
  today: string;
  onOpen: () => void;
}) {
  const { subjects } = useWorkspace();
  const e = m.planning.exams;
  const subject = subjects.find((item) => item.id === exam.subjectId);
  const name = exam.title ? `${exam.kind}: ${exam.title}` : exam.kind;
  return (
    <li data-subj={subjectColorAttr(subject?.color)}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={format(e.editNamed, { name: `${name}, ${subject?.name ?? e.noSubject}` })}
        className="lg-row grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 rounded-[2px] px-2 py-3.5 text-left text-ink"
      >
        <span className="w-14 text-center leading-none">
          <span className="block font-heading text-3xl tabular-nums">
            {Number(exam.date.slice(8))}
          </span>
          <span className="mt-1 block text-meta text-ink-muted">{monthShort(exam.date)}</span>
        </span>
        <span className="min-w-0">
          <span className="block truncate font-heading text-xl tracking-[-0.2px]">{name}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
            <span aria-hidden="true" className="lg-dot" />
            <span>{subject?.name ?? e.noSubject}</span>
            {exam.time && <span>· {format(e.at, { time: exam.time })}</span>}
          </span>
          {exam.topics && (
            <span className="mt-0.5 block truncate text-sm text-ink-secondary">{exam.topics}</span>
          )}
        </span>
        <span className="text-right text-sm text-ink-muted tabular-nums">
          {relativeDay(exam.date, today)}
        </span>
      </button>
    </li>
  );
}

/** Alle Testeinträge: erst die anstehenden (nächster zuerst), vergangene eingeklappt darunter. */
export function ExamsPage() {
  const { status, exams, now, reload } = usePlanner();
  const e = m.planning.exams;
  const today = localDate(now);
  const [dialog, setDialog] = useState<{ exam?: Exam } | null>(null);
  const { upcoming, past } = groupExams(exams, today);

  return (
    <Sheet width="wide">
      <h1 className="mo-rise font-heading text-[clamp(34px,5.4vw,52px)] leading-[1.1] tracking-[-0.025em]">
        {e.title}
      </h1>
      <p className="mo-rise mo-i-1 mt-3 max-w-[60ch] text-ink-secondary">{e.lead}</p>

      {status === 'error' ? (
        <div className="mt-8">
          <p role="alert" className="text-ink-secondary">
            {m.planning.loadFailed}
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => void reload()}>
            {m.common.retry}
          </Button>
        </div>
      ) : status === 'loading' ? (
        <p role="status" className="mt-8 text-ink-muted">
          {m.planning.loading}
        </p>
      ) : (
        <>
          <div className="mo-rise mo-i-2 mt-6">
            <Button variant="primary" onClick={() => setDialog({})}>
              <Plus aria-hidden="true" className="size-4" />
              {e.add}
            </Button>
          </div>

          {exams.length === 0 ? (
            <div className="mt-8 rounded-box bg-paper p-4">
              <p className="font-medium">{e.emptyTitle}</p>
              <p className="mt-1 text-sm text-ink-secondary">{e.emptyHint}</p>
            </div>
          ) : (
            <>
              <section className="mt-10" aria-labelledby="exams-upcoming">
                <h2 id="exams-upcoming" className={`${sectionTitle} mb-3.5`}>
                  {e.upcoming}
                </h2>
                {upcoming.length === 0 ? (
                  <p className="text-ink-muted">{e.noUpcoming}</p>
                ) : (
                  <ul className="divide-y divide-line-warm border-y border-line-warm">
                    {upcoming.map((exam) => (
                      <ExamRow
                        key={exam.id}
                        exam={exam}
                        today={today}
                        onOpen={() => setDialog({ exam })}
                      />
                    ))}
                  </ul>
                )}
              </section>

              {past.length > 0 && (
                <details className="mt-10">
                  <summary className={`${sectionTitle} flex min-h-11 cursor-pointer items-center`}>
                    {e.past} ({past.length})
                  </summary>
                  <ul className="mt-2 divide-y divide-line-warm border-y border-line-warm">
                    {past.map((exam) => (
                      <ExamRow
                        key={exam.id}
                        exam={exam}
                        today={today}
                        onOpen={() => setDialog({ exam })}
                      />
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </>
      )}
      {dialog && <ExamDialog exam={dialog.exam} onClose={() => setDialog(null)} />}
    </Sheet>
  );
}
