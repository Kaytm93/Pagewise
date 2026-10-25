import { ArrowRight } from 'lucide-react';
import type { Subject, TimetableEntry } from '../../api/types';
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
import { usePointerGlow } from '../../ui/pointer-glow';
import { SubjectIcon } from '../../ui/SubjectIcon';
import { subjectColorAttr } from '../../ui/subject-color';
import { useDesign } from '../../ui/useDesign';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { StartMotif } from './StartMotif';

type State = 'past' | 'now' | 'next';

/** Lücken kürzer als das sind keine Pause, sondern nur ein Wechsel (wie in `raum/StartPlan.tsx`). */
const MIN_BREAK = 5;

/** So viele Themen nennt die Zeile „Stoff laut Plan“, der Rest steht als „und N weitere“. */
const MAX_TOPICS = 4;

type Row =
  | { kind: 'lesson'; lesson: TimetableEntry; state: State; lead: boolean }
  | { kind: 'break'; id: string; minutes: number }
  | { kind: 'now'; label: string };

/**
 * Startseite in der Designrichtung „Atelier“ (Mockup B): links „Als Nächstes“, die Stunden von heute mit
 * „Jetzt“-Linie und der laufenden oder nächsten Stunde als großer Zeile; rechts „Anstehend“ mit der Zahl der
 * Tage bis zum nächsten Test, dem Stoff, dem Wochenstreifen (Montag bis Freitag) und zwei Wegen weiter.
 * Erscheint nur in dieser Richtung und nur, wenn der Plan geladen ist. Zustände und Linie sind Text, nicht
 * nur Farbe oder Bewegung.
 */
export function StartAtelier() {
  const design = useDesign();
  usePointerGlow();
  const { status, entries, exams, weekAnchor, now } = usePlanner();
  const { subjects } = useWorkspace();
  if (design !== 'atelier' || status !== 'ready') return null;

  const a = m.planning.atelierStart;
  const r = m.planning.raumStart;
  const today = localDate(now);
  const minutes = minutesOfDay(now);
  const lessons = lessonsOn(entries, today, weekAnchor);
  const exam = groupExams(exams, today).upcoming[0];

  const subjectOf = (id: string | null) => subjects.find((subject) => subject.id === id);
  const examSubject = subjectOf(exam?.subjectId ?? null);
  const examName = examSubject?.name ?? m.planning.timetable.noSubject;

  const examLine = exam
    ? [
        format(m.planning.startGrid.examHeading, { kind: exam.kind, subject: examName }),
        formatDate(exam.date, 'long'),
        exam.time ? format(m.planning.exams.at, { time: exam.time }) : null,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  const rows = dayRows(lessons, minutes);
  const count =
    lessons.length === 1 ? r.count.one : format(r.count.many, { count: lessons.length });

  const topics = topicsOf(exam?.topics ?? null);
  const shownTopics = topics.slice(0, MAX_TOPICS);
  const moreTopics = topics.length - shownTopics.length;

  // Montag bis Freitag; am Wochenende zeigt der Streifen die kommende Woche.
  const weekday = weekdayOf(today);
  const weekend = weekday >= 6;
  const monday = addDays(today, weekend ? 8 - weekday : 1 - weekday);
  const week = Array.from({ length: 5 }, (_, index) => {
    const date = addDays(monday, index);
    return {
      date,
      label: format(a.dayDate, {
        day: m.planning.daysShort[index] ?? '',
        date: String(Number(date.slice(8, 10))),
      }),
      exams: exams.filter((entry) => entry.date === date),
      today: date === today,
    };
  });

  return (
    <div className="at-start mo-rise mo-i-3 mt-12">
      <StartMotif />
      <div className="at-grid">
        <section className="at-day-sec" aria-labelledby="at-day-heading">
          <h2 className="at-sec">
            <span id="at-day-heading">{m.planning.nextUp.title}</span>
            {lessons.length > 0 && <small>{format(a.todayCount, { count })}</small>}
          </h2>

          {entries.length === 0 ? (
            <div className="at-empty">
              <p>{m.planning.nextUp.noTimetable}</p>
              <Link to={{ name: 'timetable' }} className="at-more">
                {m.planning.nextUp.setUp}
              </Link>
            </div>
          ) : (
            <>
              {lessons.length === 0 ? (
                <p className="at-empty">{r.empty}</p>
              ) : (
                <ol className="at-day">
                  {rows.map((row) => {
                    if (row.kind === 'now') {
                      return (
                        <li key="now" className="at-now">
                          <span>{row.label}</span>
                          <span aria-hidden="true" className="at-now-line" />
                        </li>
                      );
                    }
                    if (row.kind === 'break') {
                      return (
                        <li key={row.id} className="at-break">
                          {r.break} · {format(m.duration.minutes, { count: row.minutes })}
                        </li>
                      );
                    }
                    const { lesson, state, lead } = row;
                    return (
                      <li
                        key={lesson.id}
                        className="at-day-row"
                        data-subj={subjectColorAttr(subjectOf(lesson.subjectId)?.color)}
                        data-state={state}
                        data-lead={lead ? 'true' : undefined}
                      >
                        <LessonItem
                          lesson={lesson}
                          subject={subjectOf(lesson.subjectId)}
                          state={state}
                          lead={lead}
                          minutes={minutes}
                        />
                      </li>
                    );
                  })}
                </ol>
              )}
              <Link to={{ name: 'timetable' }} className="at-more">
                {m.planning.nextUp.openTimetable}
              </Link>
            </>
          )}
        </section>

        <section
          className="at-test"
          aria-labelledby="at-test-heading"
          data-subj={subjectColorAttr(examSubject?.color)}
        >
          <h2 id="at-test-heading" className="at-sec">
            {a.upcoming}
          </h2>

          {exam ? (
            <>
              <div className="at-count">
                <span aria-hidden="true" className="at-count-num">
                  {daysUntil(exam.date, today)}
                </span>
                <p className="at-count-what">
                  <b>{relativeDay(exam.date, today)}</b>
                  {examLine}
                </p>
              </div>
              {topics.length > 0 && (
                <p className="at-topics">
                  <span>{a.topics}</span> {shownTopics.join(', ')}
                  {moreTopics > 0 &&
                    ` ${format(m.planning.startGrid.moreTopics, { count: moreTopics })}`}
                </p>
              )}
            </>
          ) : (
            <div className="at-empty">
              <p>{m.planning.nextUp.noExams}</p>
            </div>
          )}

          <h3 id="at-week-heading" className="at-week-title">
            {weekend ? a.nextWeek : a.week}
          </h3>
          <ol className="at-week" aria-labelledby="at-week-heading">
            {week.map((day) => (
              <li
                key={day.date}
                className="at-week-item"
                data-subj={subjectColorAttr(subjectOf(day.exams[0]?.subjectId ?? null)?.color)}
                data-test={day.exams.length > 0 ? 'true' : undefined}
                aria-current={day.today ? 'date' : undefined}
              >
                <b className="at-week-day">{day.label}</b>
                {day.today && <span className="at-week-note">{a.today}</span>}
                {day.exams.map((entry) => (
                  <span key={entry.id} className="at-week-note">
                    {entry.kind}
                  </span>
                ))}
              </li>
            ))}
          </ol>

          <div className="at-cta">
            {exam && examSubject && topics.length > 0 && (
              <Link
                to={{ name: 'subject', subjectId: examSubject.id, groupId: null }}
                className="at-btn at-btn-primary"
              >
                {a.toSubject}
              </Link>
            )}
            <Link to={{ name: 'exams' }} className="at-btn at-btn-quiet">
              {exam ? m.planning.nextUp.allExams : m.planning.nextUp.addExam}
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Eine Zeile der Tagesliste: Uhrzeit, Fach mit Symbol und rechts der Stand. Die große Zeile trägt einen Pfeil. */
function LessonItem({
  lesson,
  subject,
  state,
  lead,
  minutes,
}: {
  lesson: TimetableEntry;
  subject: Subject | undefined;
  state: State;
  lead: boolean;
  minutes: number;
}) {
  const a = m.planning.atelierStart;
  const meta = [
    lesson.room ? format(m.planning.nextUp.lessonNowRoom, { room: lesson.room }) : null,
    state === 'now'
      ? format(m.planning.dayLine.minutesLeft, { minutes: toMinutes(lesson.endTime) - minutes })
      : null,
    state === 'next' && lead
      ? format(a.startsIn, { minutes: toMinutes(lesson.startTime) - minutes })
      : null,
    state === 'past' ? m.planning.raumStart.past : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const body = (
    <>
      <time dateTime={lesson.startTime} className="at-time">
        {lesson.startTime}
        <span className="sr-only"> – {lesson.endTime}</span>
      </time>
      <span className="at-who">
        {subject && <SubjectIcon icon={subject.icon} className="at-who-icon" />}
        <span className="at-who-name">{subject?.name ?? m.planning.timetable.noSubject}</span>
      </span>
      <span className="at-meta">
        {meta}
        {lead && <ArrowRight aria-hidden="true" strokeWidth={1.8} className="at-arrow" />}
      </span>
    </>
  );
  const current = state === 'now' ? ('time' as const) : undefined;
  return lesson.subjectId ? (
    <Link
      to={{ name: 'subject', subjectId: lesson.subjectId, groupId: null }}
      className="at-lesson at-glow"
      aria-current={current}
    >
      {body}
    </Link>
  ) : (
    <div className="at-lesson" aria-current={current}>
      {body}
    </div>
  );
}

/**
 * Die Tagesliste als Zeilen: Stunden, dazwischen Pausen (ab `MIN_BREAK` Minuten) und die „Jetzt“-Linie vor
 * der laufenden oder nächsten Stunde. Liegt „Jetzt“ in einer Pause, trägt die Linie deren Ende statt einer
 * zweiten Pausenzeile. Die große Zeile ist die laufende, sonst die nächste Stunde.
 */
function dayRows(lessons: TimetableEntry[], minutes: number): Row[] {
  const stateOf = (lesson: TimetableEntry): State =>
    toMinutes(lesson.endTime) <= minutes
      ? 'past'
      : toMinutes(lesson.startTime) <= minutes
        ? 'now'
        : 'next';
  const running = lessons.findIndex((lesson) => stateOf(lesson) === 'now');
  const firstNext = lessons.findIndex((lesson) => stateOf(lesson) === 'next');
  const leadAt = running !== -1 ? running : firstNext;
  const markerAt = leadAt !== -1 ? leadAt : lessons.length;
  const clock = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const now = (until?: string): Row => ({
    kind: 'now',
    label: until
      ? format(m.planning.atelierStart.nowBreak, { time: clock, until })
      : format(m.planning.raumStart.now, { time: clock }),
  });

  const rows: Row[] = [];
  lessons.forEach((lesson, index) => {
    const previous = lessons[index - 1];
    const gap = previous ? toMinutes(lesson.startTime) - toMinutes(previous.endTime) : 0;
    const longBreak = gap >= MIN_BREAK;
    const inBreak = longBreak && index === markerAt && running === -1;
    if (longBreak && !inBreak) rows.push({ kind: 'break', id: `pause-${lesson.id}`, minutes: gap });
    if (index === markerAt) rows.push(now(inBreak ? lesson.startTime : undefined));
    rows.push({ kind: 'lesson', lesson, state: stateOf(lesson), lead: index === leadAt });
  });
  if (markerAt === lessons.length) rows.push(now());
  return rows;
}

/** Die Themen eines Tests: Freitext, an Zeilenumbrüchen getrennt, ohne leere Einträge. */
function topicsOf(raw: string | null): string[] {
  return (raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
