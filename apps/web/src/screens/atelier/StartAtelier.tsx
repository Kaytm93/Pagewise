import type { TimetableEntry } from '../../api/types';
import { format, messages as m } from '../../i18n';
import {
  addDays,
  formatDate,
  localDate,
  minutesOfDay,
  toMinutes,
  weekdayOf,
} from '../../planning/dates';
import { relativeDay } from '../../planning/labels';
import { usePlanner } from '../../planning/PlannerProvider';
import { daysUntil, groupExams, lessonsOn } from '../../planning/schedule';
import { Link } from '../../ui/Link';
import { sectionTitle } from '../../ui/styles';
import { subjectColorAttr } from '../../ui/subject-color';
import { useDesign } from '../../ui/useDesign';
import { useWorkspace } from '../../workspace/WorkspaceProvider';

/** Mehr Stunden zeigt die Liste unter der Leitkarte nicht. */
const MAX_REST = 4;

/**
 * Startseite in der Designrichtung „Atelier“: oben die Leitkarte mit der nächsten Stunde von heute (oder dem
 * nächsten Test), daneben die große Zahl der verbleibenden Tage, darunter der Wochenstreifen und die übrigen
 * Stunden von heute. Erscheint nur in dieser Richtung und nur, wenn der Plan geladen ist.
 */
export function StartAtelier() {
  const design = useDesign();
  const { status, entries, exams, weekAnchor, now } = usePlanner();
  const { subjects } = useWorkspace();
  if (design !== 'atelier' || status !== 'ready') return null;

  const a = m.planning.atelierStart;
  const today = localDate(now);
  const minutes = minutesOfDay(now);
  const lessons = lessonsOn(entries, today, weekAnchor);
  const remaining = lessons.filter((lesson) => toMinutes(lesson.endTime) > minutes);
  const lead = remaining[0];
  const rest = remaining.slice(1, 1 + MAX_REST);
  const exam = groupExams(exams, today).upcoming[0];

  const subjectOf = (id: string | null) => subjects.find((subject) => subject.id === id);
  const nameOf = (id: string | null) => subjectOf(id)?.name ?? m.planning.timetable.noSubject;

  const days = exam ? daysUntil(exam.date, today) : 0;
  const dayLabel = days === 1 ? a.oneDay : format(a.days, { count: days });

  // Der Streifen beginnt am Montag dieser Woche; die Spalte von heute ist markiert.
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index - (weekdayOf(today) - 1));
    return {
      date,
      count: lessonsOn(entries, date, weekAnchor).length,
      today: date === today,
    };
  });

  return (
    <section className="at-start mo-rise mo-i-3 mt-12" aria-labelledby="at-start-heading">
      <h2 id="at-start-heading" className={sectionTitle}>
        {m.planning.nextUp.title}
      </h2>

      <div className="at-start-top">
        <div
          className="at-lead"
          data-subj={subjectColorAttr(subjectOf((lead ?? exam)?.subjectId ?? null)?.color)}
        >
          {lead ? (
            <LessonCard lesson={lead} name={nameOf(lead.subjectId)} />
          ) : exam ? (
            <ExamCard
              kind={exam.kind}
              subject={nameOf(exam.subjectId)}
              date={exam.date}
              today={today}
            />
          ) : (
            <div className="at-lead-empty">
              <p>{m.planning.nextUp.noExams}</p>
              <Link to={{ name: 'exams' }} className="at-lead-more">
                {m.planning.nextUp.addExam}
              </Link>
            </div>
          )}
        </div>

        <div
          className="at-count"
          data-subj={subjectColorAttr(subjectOf(exam?.subjectId ?? null)?.color)}
        >
          {exam ? (
            <>
              <p className="at-count-num font-heading text-[clamp(56px,9vw,96px)] tabular-nums">
                <span aria-hidden="true">{days}</span>
                <span className="sr-only">{dayLabel}</span>
              </p>
              <p className="at-count-sub">
                {format(a.untilExam, { subject: nameOf(exam.subjectId) })}
              </p>
            </>
          ) : (
            <>
              <p className="at-count-num font-heading text-[clamp(56px,9vw,96px)] tabular-nums">
                <span aria-hidden="true">{lessons.length}</span>
                <span className="sr-only">{a.hoursToday}</span>
              </p>
              <p className="at-count-sub">{a.hoursToday}</p>
            </>
          )}
        </div>
      </div>

      <section className="at-week" aria-labelledby="at-week-heading">
        <h3 id="at-week-heading" className={sectionTitle}>
          {a.week}
        </h3>
        <ol className="at-week-grid">
          {week.map((day, index) => (
            <li
              key={day.date}
              className="at-week-col"
              data-empty={day.count === 0 ? 'true' : undefined}
              aria-current={day.today ? 'date' : undefined}
            >
              <span className="at-week-track">
                <span
                  ref={barRef(day.count)}
                  className={`at-week-bar mo-i-${index + 1}`}
                  aria-hidden="true"
                />
              </span>
              <span className="at-week-label">
                <span className="at-week-day">{m.planning.daysShort[index] ?? ''}</span>
                {day.today && <span className="at-week-today">{a.today}</span>}
              </span>
              <span className="sr-only">
                {day.count === 1
                  ? m.planning.raumStart.count.one
                  : format(m.planning.raumStart.count.many, { count: day.count })}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="at-next">
        {entries.length === 0 ? (
          <>
            <p>{m.planning.nextUp.noTimetable}</p>
            <Link to={{ name: 'timetable' }} className="at-next-link">
              {m.planning.nextUp.setUp}
            </Link>
          </>
        ) : remaining.length === 0 ? (
          <>
            <p>{m.planning.nextUp.nothingToday}</p>
            <Link to={{ name: 'timetable' }} className="at-next-link">
              {m.planning.nextUp.openTimetable}
            </Link>
          </>
        ) : (
          <>
            {rest.length > 0 && (
              <ol className="at-next-list">
                {rest.map((lesson) => (
                  <li
                    key={lesson.id}
                    className="at-next-item"
                    data-subj={subjectColorAttr(subjectOf(lesson.subjectId)?.color)}
                  >
                    <time dateTime={lesson.startTime} className="tabular-nums">
                      {lesson.startTime}
                      <span className="sr-only"> – {lesson.endTime}</span>
                    </time>
                    <span className="at-next-name">{nameOf(lesson.subjectId)}</span>
                    {lesson.room && (
                      <span className="at-next-room">
                        {format(m.planning.nextUp.lessonNowRoom, { room: lesson.room })}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <Link to={{ name: 'timetable' }} className="at-next-link">
              {m.planning.nextUp.openTimetable}
            </Link>
          </>
        )}
      </div>
    </section>
  );
}

/** Die Leitkarte für die nächste Stunde: ein einziger Link auf das Fach (oder auf den Stundenplan). */
function LessonCard({ lesson, name }: { lesson: TimetableEntry; name: string }) {
  return (
    <Link
      to={
        lesson.subjectId
          ? { name: 'subject', subjectId: lesson.subjectId, groupId: null }
          : { name: 'timetable' }
      }
      className="at-lead-link"
    >
      <span className="at-lead-kicker">{m.planning.atelierStart.nextLesson}</span>
      <span className="at-lead-name">{name}</span>
      <span className="at-lead-meta">
        <time dateTime={lesson.startTime} className="tabular-nums">
          {lesson.startTime}
          <span className="sr-only"> – {lesson.endTime}</span>
        </time>
        {lesson.room && (
          <span>{format(m.planning.nextUp.lessonNowRoom, { room: lesson.room })}</span>
        )}
      </span>
    </Link>
  );
}

/** Die Leitkarte für den nächsten Test: ein einziger Link auf die Tests. */
function ExamCard({
  kind,
  subject,
  date,
  today,
}: {
  kind: string;
  subject: string;
  date: string;
  today: string;
}) {
  return (
    <Link to={{ name: 'exams' }} className="at-lead-link">
      <span className="at-lead-kicker">{m.planning.nextUp.examTitle}</span>
      <span className="at-lead-name">{subject}</span>
      <span className="at-lead-meta">
        <span>{kind}</span>
        <span>{formatDate(date, 'long')}</span>
        <span>{relativeDay(date, today)}</span>
      </span>
    </Link>
  );
}

/**
 * Die Zahl der Stunden eines Tages als CSS-Variable für `calc()` im Wochenstreifen. Bewusst kein
 * `style`-Attribut mit Werten: der Wert geht über `setProperty` an das Element.
 */
function barRef(count: number) {
  return (element: HTMLSpanElement | null) => {
    element?.style.setProperty('--at-bar', String(count));
  };
}
