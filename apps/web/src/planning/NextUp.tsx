import { format, messages as m } from '../i18n';
import { Link } from '../ui/Link';
import { subjectColorAttr } from '../ui/subject-color';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { formatDate, localDate } from './dates';
import { relativeDay } from './labels';
import { usePlanner } from './PlannerProvider';
import { currentLesson, groupExams, nextLesson } from './schedule';

/**
 * „Als Nächstes“ auf der Startseite: die laufende oder nächste Stunde und der nächste Test als Zettel. Ohne
 * Stundenplan und ohne Tests steht hier ein Hinweis, wie man sie einträgt. Solange die Daten laden oder
 * nicht geladen werden konnten, bleibt der Bereich weg: Die Startseite funktioniert auch ohne.
 */
export function NextUp() {
  const { status, entries, exams, weekAnchor, now } = usePlanner();
  const { subjects } = useWorkspace();
  const n = m.planning.nextUp;
  if (status !== 'ready') return null;

  const today = localDate(now);
  const subjectOf = (id: string | null) => subjects.find((subject) => subject.id === id);
  const nameOf = (id: string | null) => subjectOf(id)?.name ?? m.planning.timetable.noSubject;

  const running = currentLesson(entries, now, weekAnchor);
  const upcoming = nextLesson(entries, now, weekAnchor);
  const exam = groupExams(exams, today).upcoming[0];

  // Erste Zeile: die laufende Stunde, sonst die nächste. Zweite Zeile: was danach heute kommt oder dass heute
  // nichts mehr kommt.
  const describe = (next: NonNullable<typeof upcoming>) => {
    const subject = nameOf(next.lesson.subjectId);
    return next.inDays === 0
      ? format(n.lessonToday, { subject, time: next.lesson.startTime })
      : format(n.lessonLater, {
          subject,
          day: m.planning.days[next.lesson.weekday - 1] as string,
          time: next.lesson.startTime,
        });
  };
  let primary: string | null = null;
  let secondary: string | null = null;
  let room: string | null = null;
  let colorOf: string | null = null;
  if (running) {
    primary = format(n.lessonNow, {
      subject: nameOf(running.lesson.subjectId),
      minutes: running.minutesLeft,
    });
    room = running.lesson.room;
    colorOf = running.lesson.subjectId;
    if (upcoming && upcoming.inDays === 0) secondary = describe(upcoming);
  } else if (upcoming) {
    primary = describe(upcoming);
    room = upcoming.lesson.room;
    colorOf = upcoming.lesson.subjectId;
    if (upcoming.inDays > 0) secondary = n.nothingToday;
  }

  return (
    <section className="mo-rise mo-i-3 mt-12" aria-labelledby="next-up-heading">
      <h2
        id="next-up-heading"
        className="mb-3.5 font-sans text-[15px] font-medium tracking-[0.06em] text-ink-muted uppercase"
      >
        {n.title}
      </h2>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div data-subj={subjectColorAttr(subjectOf(colorOf)?.color)}>
          {entries.length === 0 ? (
            <>
              <p className="text-ink-secondary">{n.noTimetable}</p>
              <Link to={{ name: 'timetable' }} className="mt-1 inline-flex min-h-11 items-center">
                {n.setUp}
              </Link>
            </>
          ) : (
            <>
              <p className="font-heading text-2xl leading-snug tracking-[-0.01em] text-balance">
                {primary ?? n.nothingToday}
              </p>
              {secondary && <p className="mt-1 text-ink-secondary">{secondary}</p>}
              {room && (
                <p className="mt-1 text-sm text-ink-muted">{format(n.lessonNowRoom, { room })}</p>
              )}
              <Link to={{ name: 'timetable' }} className="mt-1 inline-flex min-h-11 items-center">
                {n.openTimetable}
              </Link>
            </>
          )}
        </div>

        <div
          className="md:pt-1"
          data-subj={subjectColorAttr(subjectOf(exam?.subjectId ?? null)?.color)}
        >
          {exam ? (
            <div className="lg-slip">
              <span
                aria-hidden="true"
                className="lg-tape top-[-12px] left-1/2 -ml-14 [--r:1.6deg]"
              />
              <p className="text-sm font-medium text-ink-muted">{n.examTitle}</p>
              <p className="mt-2 font-heading text-[clamp(2rem,4.5vw,3rem)] leading-none tracking-[-0.04em] break-words">
                {relativeDay(exam.date, today)}
              </p>
              <p className="mt-2 text-ink-secondary">
                {exam.title ? `${exam.kind}: ${exam.title}` : exam.kind} · {nameOf(exam.subjectId)}
              </p>
              <p className="text-sm text-ink-muted">
                {formatDate(exam.date, 'long')}
                {exam.time && `, ${format(m.planning.exams.at, { time: exam.time })}`}
              </p>
              <Link to={{ name: 'exams' }} className="mt-3 inline-flex min-h-11 items-center">
                {n.allExams}
              </Link>
            </div>
          ) : (
            <div>
              <p className="text-ink-secondary">{n.noExams}</p>
              <Link to={{ name: 'exams' }} className="mt-1 inline-flex min-h-11 items-center">
                {n.addExam}
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
