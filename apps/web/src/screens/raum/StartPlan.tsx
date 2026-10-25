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
import { type Block, layoutTimeline } from './timeline';

type Row = Block | { kind: 'now' };

/**
 * Stundenplan der Startseite in der Designrichtung „Raum“ (Mockup C): eine Zeitachse. Die Zeiten stehen links,
 * die Stunden von heute als Karten mit der Fachfarbe als Kante an ihrer Uhrzeit, dazwischen die Pausen, und die
 * „Jetzt“-Marke mit Punkt wandert mit der Uhr (`--now`, in Minuten ab der ersten Stunde). Vergangenes ist
 * gedämpft. Erscheint nur in dieser Richtung und nur, wenn der Plan geladen ist; ohne Stunden von heute gibt es
 * auch keine Marke. Die Rechnung steht in `timeline.ts`.
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
  const weekday = m.planning.days[weekdayOf(today) - 1] as string;

  const sorted = [...lessons].sort(
    (a, b) =>
      toMinutes(a.startTime) - toMinutes(b.startTime) ||
      toMinutes(a.endTime) - toMinutes(b.endTime),
  );
  const timeline = layoutTimeline(
    sorted.map((lesson) => ({
      id: lesson.id,
      start: toMinutes(lesson.startTime),
      end: toMinutes(lesson.endTime),
    })),
    minutes,
  );
  const running = timeline.runningIndex !== -1 ? sorted[timeline.runningIndex] : undefined;
  const runningMinutesLeft = running ? toMinutes(running.endTime) - minutes : 0;

  // Reihenfolge im Dokument: die Marke steht vor der laufenden, sonst vor der nächsten Stunde.
  const rows: Row[] = [];
  let lessonSeen = 0;
  for (const block of timeline.blocks) {
    if (block.kind === 'lesson') {
      if (lessonSeen === timeline.markerBefore) rows.push({ kind: 'now' });
      lessonSeen += 1;
    }
    rows.push(block);
  }
  if (timeline.markerBefore >= sorted.length) rows.push({ kind: 'now' });

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
        <ol ref={axisRef(timeline.unit, timeline.span)} className="rm-day-list rm-plan-list">
          {rows.map((row, position) => {
            if (row.kind === 'now') {
              const isRunning = running !== undefined;
              return (
                <li
                  key="now"
                  ref={markerRef(timeline.nowAt, timeline.nowLabelShift)}
                  role={isRunning ? 'presentation' : undefined}
                  className="rm-plan-now"
                >
                  <span className="rm-plan-now-label">
                    {isRunning && <span className="sr-only">{weekday}, </span>}
                    {isRunning && '\u200B'}
                    {format(r.now, { time: clock })}
                    {isRunning && (
                      <span className="sr-only">
                        , {format(r.remaining, { count: runningMinutesLeft })}
                      </span>
                    )}
                  </span>
                  <span aria-hidden="true" className="rm-plan-now-dot" />
                  <span aria-hidden="true" className="rm-plan-now-line" />
                </li>
              );
            }

            const stagger = position < 8 ? `mo-i-${position + 1}` : 'mo-i-8';

            if (row.kind === 'break') {
              return (
                <li
                  key={row.id}
                  role="presentation"
                  ref={blockRef(row.at, row.len)}
                  className={`rm-plan-break mo-rise ${stagger}`}
                >
                  {/* Kurze Lücken zeigen nur die Linie; der Text bleibt für Screenreader. */}
                  <span className={row.len * timeline.unit < 24 ? 'sr-only' : 'min-w-0'}>
                    {r.break} · {format(m.duration.minutes, { count: row.minutes })}
                  </span>
                </li>
              );
            }

            const lesson = sorted[row.index] as TimetableEntry;
            const { state } = row;
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
                ref={blockRef(row.at, row.len)}
                data-subj={subjectColorAttr(subject?.color)}
                data-state={state}
                aria-current={state === 'now' ? 'time' : undefined}
                className={`rm-plan-item mo-rise ${stagger}`}
              >
                <time className="rm-plan-time tabular-nums">
                  {lesson.startTime}
                  <span className="sr-only"> – {lesson.endTime}</span>
                </time>
                <span className="rm-plan-card">
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

/*
 * Zahlen gehen als CSS-Variablen an die Elemente, nie als `style`-Attribut (Regel: dynamische Werte nur über
 * setProperty). Die Achse trägt Pixel je Minute und Länge; jeder Block seinen Beginn und seine Dauer in
 * Minuten, die Marke ihre Stelle und den Versatz ihres Zettels.
 */
function axisRef(unit: number, span: number) {
  return (element: HTMLOListElement | null) => {
    element?.style.setProperty('--tl-unit', `${unit}px`);
    element?.style.setProperty('--tl-span', String(span));
  };
}

function blockRef(at: number, len: number) {
  return (element: HTMLLIElement | null) => {
    element?.style.setProperty('--at', String(at));
    element?.style.setProperty('--len', String(len));
  };
}

function markerRef(at: number, labelShift: number) {
  return (element: HTMLLIElement | null) => {
    element?.style.setProperty('--now', String(at));
    element?.style.setProperty('--now-shift', String(labelShift));
  };
}
