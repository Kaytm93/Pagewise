import type { TimetableEntry } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { formatDate, localDate, minutesOfDay, toMinutes, weekdayOf } from '../../planning/dates';
import { usePlanner } from '../../planning/PlannerProvider';
import { lessonsOn } from '../../planning/schedule';
import { Link } from '../../ui/Link';
import { sectionTitle } from '../../ui/styles';
import { subjectColorAttr } from '../../ui/subject-color';
import { useDesign } from '../../ui/useDesign';
import { useWorkspace } from '../../workspace/WorkspaceProvider';

type State = 'past' | 'now' | 'next';

/** Lücken kürzer als das sind keine Pause, sondern nur ein Wechsel. */
const MIN_BREAK = 5;

interface LessonRow {
  kind: 'lesson';
  lesson: TimetableEntry;
  state: State;
  block: number;
}

interface BreakRow {
  kind: 'break';
  id: string;
  minutes: number;
  block: number;
}

interface NowRow {
  kind: 'now';
}

type Row = LessonRow | BreakRow | NowRow;

/**
 * Stundenplan der Startseite in der Designrichtung „Raum“: die Stunden von heute als Spalte, dazwischen die
 * Pausen, an der laufenden Stelle die „Jetzt“-Linie. Vergangenes ist gedämpft, die laufende Stunde trägt die
 * Fachfarbe als linke Kante. Erscheint nur in dieser Richtung und nur, wenn der Plan geladen ist.
 */
export function StartPlan() {
  const design = useDesign();
  const { status, entries, weekAnchor, now } = usePlanner();
  const { subjects } = useWorkspace();
  if (design !== 'raum' || status !== 'ready') return null;

  const today = localDate(now);
  const lessons = lessonsOn(entries, today, weekAnchor);
  const r = m.planning.raumStart;
  const minutes = minutesOfDay(now);
  const clock = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const stateOf = (start: string, end: string): State =>
    toMinutes(end) <= minutes ? 'past' : toMinutes(start) <= minutes ? 'now' : 'next';

  const runningIndex = lessons.findIndex(
    (lesson) => stateOf(lesson.startTime, lesson.endTime) === 'now',
  );
  const firstNext = lessons.findIndex(
    (lesson) => stateOf(lesson.startTime, lesson.endTime) === 'next',
  );
  const markerAt =
    runningIndex !== -1 ? runningIndex : firstNext !== -1 ? firstNext : lessons.length;
  const runningLesson = runningIndex !== -1 ? lessons[runningIndex] : undefined;
  const runningMinutesLeft = runningLesson ? toMinutes(runningLesson.endTime) - minutes : 0;
  const weekday = m.planning.days[weekdayOf(today) - 1] as string;

  const rows: Row[] = [];
  let block = 0;
  lessons.forEach((lesson, index) => {
    const previous = lessons[index - 1];
    if (previous) {
      const gap = toMinutes(lesson.startTime) - toMinutes(previous.endTime);
      if (gap >= MIN_BREAK) {
        rows.push({ kind: 'break', id: `pause-${lesson.id}`, minutes: gap, block: block++ });
      }
    }
    if (index === markerAt) rows.push({ kind: 'now' });
    rows.push({
      kind: 'lesson',
      lesson,
      state: stateOf(lesson.startTime, lesson.endTime),
      block: block++,
    });
  });
  if (markerAt === lessons.length) rows.push({ kind: 'now' });

  const count =
    lessons.length === 1 ? r.count.one : format(r.count.many, { count: lessons.length });

  return (
    <section
      className="rm-plan mo-rise mo-i-3 mt-12"
      aria-label={lessons.length > 0 ? m.planning.dayLine.title : undefined}
    >
      <div className="rm-plan-head">
        <h2 className={`${sectionTitle} rm-plan-day`}>{weekday}</h2>
        <p className="rm-plan-date">{formatDate(today)}</p>
        <p className="rm-plan-count">{count}</p>
      </div>

      {lessons.length === 0 ? (
        <div className="rm-plan-empty">
          <p className="text-ink-secondary">
            {entries.length === 0 ? m.planning.nextUp.noTimetable : r.empty}
          </p>
          <Link to={{ name: 'timetable' }} className="mt-1 inline-flex min-h-11 items-center">
            {m.planning.nextUp.setUp}
          </Link>
        </div>
      ) : (
        <ol className="rm-day-list rm-plan-list">
          {rows.map((row) => {
            if (row.kind === 'now') {
              const running = runningLesson !== undefined;
              return (
                <li key="now" role={running ? 'presentation' : undefined} className="rm-plan-now">
                  <span className="rm-plan-now-label">
                    {running && <span className="sr-only">{weekday}, </span>}
                    {running && '\u200B'}
                    {format(r.now, { time: clock })}
                    {running && (
                      <span className="sr-only">
                        , {format(r.remaining, { count: runningMinutesLeft })}
                      </span>
                    )}
                  </span>
                  <span aria-hidden="true" className="rm-plan-now-line" />
                </li>
              );
            }

            const stagger = row.block < 8 ? `mo-i-${row.block + 1}` : 'mo-i-8';

            if (row.kind === 'break') {
              return (
                <li
                  key={row.id}
                  role="presentation"
                  ref={spanRef(row.minutes)}
                  className={`rm-plan-break mo-rise ${stagger}`}
                >
                  <span className="min-w-0">
                    {r.break} · {format(m.duration.minutes, { count: row.minutes })}
                  </span>
                </li>
              );
            }

            const { lesson, state } = row;
            const subject = subjects.find((entry) => entry.id === lesson.subjectId);
            const meta = [
              lesson.room ? format(m.planning.nextUp.lessonNowRoom, { room: lesson.room }) : null,
              state === 'now'
                ? format(m.planning.dayLine.minutesLeft, {
                    minutes: toMinutes(lesson.endTime) - minutes,
                  })
                : null,
              state === 'next' ? r.nextUp : null,
              state === 'past' ? r.past : null,
            ]
              .filter(Boolean)
              .join(' · ');

            return (
              <li
                key={lesson.id}
                ref={spanRef(toMinutes(lesson.endTime) - toMinutes(lesson.startTime))}
                data-subj={subjectColorAttr(subject?.color)}
                data-state={state}
                aria-current={state === 'now' ? 'time' : undefined}
                className={`rm-plan-item mo-rise ${stagger}`}
              >
                <time className="rm-plan-time tabular-nums">
                  {lesson.startTime}
                  <span className="sr-only"> – {lesson.endTime}</span>
                </time>
                <span className="min-w-0">
                  <span className="rm-plan-name block truncate font-heading text-lg tracking-[-0.1px]">
                    {subject?.name ?? m.planning.timetable.noSubject}
                  </span>
                  <span className="rm-plan-meta block truncate text-sm text-ink-muted">{meta}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * Die Dauer einer Stunde als Zahl für `calc(var(--raum-unit) * N)`. Bewusst kein `style`-Attribut: der Wert
 * geht als CSS-Variable an das Element (Regel: dynamische Werte nur über setProperty).
 */
function spanRef(minutes: number) {
  return (element: HTMLLIElement | null) => {
    element?.style.setProperty('--raum-span', String(minutes));
  };
}
