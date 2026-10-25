import type { ReactNode } from 'react';
import { format, messages as m } from '../../i18n';
import { formatDate, localDate, minutesOfDay, toMinutes } from '../../planning/dates';
import { relativeDay } from '../../planning/labels';
import { usePlanner } from '../../planning/PlannerProvider';
import { groupExams, lessonsOn } from '../../planning/schedule';
import { Link } from '../../ui/Link';
import { sectionTitle } from '../../ui/styles';
import { subjectColorAttr } from '../../ui/subject-color';
import { useWorkspace } from '../../workspace/WorkspaceProvider';

type State = 'past' | 'now' | 'next';

const MAX_TOPICS = 8;

/** Lücken zwischen zwei Stunden ab so vielen Minuten sind eine Pause (derselbe Wert wie in „Raum“). */
const MIN_BREAK = 5;

/**
 * Die Startseite in der Richtung „Lagen“ (M1-T1): links die Stunden von heute mit der „Jetzt“-Marke,
 * rechts der nächste Test als Zettel. Beide Seiten stehen nebeneinander, sobald das Blatt (nicht das
 * Fenster) mindestens 800 px breit ist. Zustände und Marke sind Text, damit sie auch ohne Bewegung erkennbar bleiben.
 * Zwischen zwei Stunden steht bei einer Lücke ab `MIN_BREAK` Minuten eine leise Pausenzeile.
 */
export function StartGrid() {
  const { status, entries, exams, weekAnchor, now } = usePlanner();
  const { subjects } = useWorkspace();
  if (status !== 'ready') return null;

  const today = localDate(now);
  const minutes = minutesOfDay(now);
  const lessons = lessonsOn(entries, today, weekAnchor);
  const exam = groupExams(exams, today).upcoming[0];
  const subjectOf = (id: string | null) => subjects.find((subject) => subject.id === id);
  const nameOf = (id: string | null) => subjectOf(id)?.name ?? m.planning.timetable.noSubject;

  const stateOf = (start: string, end: string): State =>
    toMinutes(end) <= minutes ? 'past' : toMinutes(start) <= minutes ? 'now' : 'next';

  // Die Marke steht vor der laufenden Stunde, sonst vor der nächsten, sonst nach der letzten.
  const runningAt = lessons.findIndex(
    (lesson) => stateOf(lesson.startTime, lesson.endTime) === 'now',
  );
  const nextAt = lessons.findIndex(
    (lesson) => stateOf(lesson.startTime, lesson.endTime) === 'next',
  );
  const markerAt = runningAt >= 0 ? runningAt : nextAt >= 0 ? nextAt : lessons.length;
  const clock = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
    minutes % 60,
  ).padStart(2, '0')}`;

  const items: ReactNode[] = [];
  lessons.forEach((lesson, index) => {
    const previous = lessons[index - 1];
    if (previous) {
      const gap = toMinutes(lesson.startTime) - toMinutes(previous.endTime);
      if (gap >= MIN_BREAK) items.push(breakRow(`pause-${lesson.id}`, previous.endTime, gap));
    }
    if (index === markerAt) items.push(marker(clock));
    const state = stateOf(lesson.startTime, lesson.endTime);
    const subject = subjectOf(lesson.subjectId);
    items.push(
      <li
        key={lesson.id}
        data-subj={subjectColorAttr(subject?.color)}
        data-state={state}
        aria-current={state === 'now' ? 'time' : undefined}
        className="lg-lesson"
      >
        <time dateTime={lesson.startTime} className="tabular-nums text-[0.90625rem] text-ink-muted">
          {lesson.startTime}
          <span className="sr-only"> – {lesson.endTime}</span>
        </time>
        <span className="min-w-0">
          <span className="flex items-baseline justify-between gap-3">
            <span className="lg-lesson-name block min-w-0 truncate font-heading text-[1.3125rem] tracking-[-0.2px]">
              {subject?.name ?? m.planning.timetable.noSubject}
            </span>
            {lesson.room && <span className="shrink-0 text-sm text-ink-muted">{lesson.room}</span>}
          </span>
          {state === 'past' && <span className="sr-only">, {m.planning.startGrid.done}</span>}
          {state === 'now' && (
            <span className="mt-1 flex flex-wrap items-center gap-x-4 text-sm text-ink-secondary">
              <span>
                {format(m.planning.startGrid.minutesLeft, {
                  minutes: toMinutes(lesson.endTime) - minutes,
                })}
              </span>
              {lesson.subjectId && (
                <Link
                  to={{ name: 'subject', subjectId: lesson.subjectId, groupId: null }}
                  className="inline-flex min-h-11 items-center"
                >
                  {m.planning.startGrid.openSubject}
                </Link>
              )}
            </span>
          )}
        </span>
      </li>,
    );
  });
  if (markerAt === lessons.length) items.push(marker(clock));

  const topics = topicsOf(exam?.topics ?? null);
  const shownTopics = topics
    .slice(0, MAX_TOPICS)
    .map((text, index) => ({ key: `${index}:${text}`, text }));
  const moreTopics = topics.length - shownTopics.length;

  return (
    <div className="@container mt-12">
      {/* Zwei Spalten ab 800 px Breite des Blatts (Container-Abfrage), nicht des Fensters: so passt das
          Raster auch neben der Seitenleiste. */}
      <div className="grid items-start gap-10 @min-[800px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] @min-[800px]:gap-14">
        <section className="mo-rise mo-i-3" aria-labelledby="start-lessons-heading">
          <h2 id="start-lessons-heading" className={`mb-3.5 ${sectionTitle}`}>
            {m.planning.nextUp.title}
          </h2>
          {lessons.length === 0 ? (
            <div>
              <p className="text-ink-secondary">
                {entries.length === 0
                  ? m.planning.nextUp.noTimetable
                  : m.planning.nextUp.nothingToday}
              </p>
              <Link to={{ name: 'timetable' }} className="mt-1 inline-flex min-h-11 items-center">
                {entries.length === 0 ? m.planning.nextUp.setUp : m.planning.nextUp.openTimetable}
              </Link>
            </div>
          ) : (
            <ol className="lg-lessons">{items}</ol>
          )}
        </section>

        <aside
          className="mo-rise mo-i-4 pt-[18px]"
          aria-labelledby="start-exam-heading"
          data-subj={subjectColorAttr(subjectOf(exam?.subjectId ?? null)?.color)}
        >
          {exam ? (
            <div className="lg-slip">
              <span
                aria-hidden="true"
                className="lg-tape top-[-12px] left-1/2 -ml-14 [--r:1.6deg]"
              />
              <h3 id="start-exam-heading" className="text-sm font-medium text-ink-muted">
                {format(m.planning.startGrid.examHeading, {
                  kind: exam.kind,
                  subject: nameOf(exam.subjectId),
                })}
              </h3>
              <p className="mt-2 font-heading text-[clamp(2rem,4.5vw,3rem)] leading-none tracking-[-0.04em] break-words">
                {relativeDay(exam.date, today)}
              </p>
              <p className="mt-2 text-ink-secondary">
                {formatDate(exam.date, 'long')}
                {exam.time && `, ${format(m.planning.exams.at, { time: exam.time })}`}
              </p>
              {topics.length > 0 && (
                <ul className="lg-topics">
                  {shownTopics.map((topic) => (
                    <li key={topic.key}>{topic.text}</li>
                  ))}
                  {moreTopics > 0 && (
                    <li className="lg-topics-more">
                      {format(m.planning.startGrid.moreTopics, { count: moreTopics })}
                    </li>
                  )}
                </ul>
              )}
              <p className="mt-3 text-sm text-ink-muted">
                {topics.length === 1
                  ? m.planning.startGrid.topicsOne
                  : format(m.planning.startGrid.topicsMany, { count: topics.length })}
              </p>
              <Link to={{ name: 'exams' }} className="mt-2 inline-flex min-h-11 items-center">
                {m.planning.nextUp.allExams}
              </Link>
            </div>
          ) : (
            <div>
              <h3 id="start-exam-heading" className={sectionTitle}>
                {m.planning.nextUp.examTitle}
              </h3>
              <p className="text-ink-secondary">{m.planning.nextUp.noExams}</p>
              <Link to={{ name: 'exams' }} className="mt-1 inline-flex min-h-11 items-center">
                {m.planning.nextUp.addExam}
              </Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Die Themen eines Tests: Freitext, an Zeilenumbrüchen getrennt, ohne leere Einträge. */
function topicsOf(raw: string | null): string[] {
  return (raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Pause zwischen zwei Stunden: Beginn der Lücke und ihre Länge (Wörter wie in „Raum“). */
function breakRow(key: string, start: string, minutes: number) {
  return (
    <li key={key} className="lg-lesson-break">
      <time dateTime={start} className="tabular-nums">
        {start}
      </time>
      <span>
        {m.planning.raumStart.break} · {format(m.duration.minutes, { count: minutes })}
      </span>
    </li>
  );
}

function marker(clock: string) {
  return (
    <li key="now" className="lg-now-marker">
      <span className="lg-now-marker-label">
        {m.planning.startGrid.now} <span className="tabular-nums">{clock}</span>
      </span>
    </li>
  );
}
