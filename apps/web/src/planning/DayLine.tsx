import { format, messages as m } from '../i18n';
import { sectionTitle } from '../ui/styles';
import { subjectColorAttr } from '../ui/subject-color';
import { useDesign } from '../ui/useDesign';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { localDate, minutesOfDay, toMinutes } from './dates';
import { usePlanner } from './PlannerProvider';
import { lessonsOn } from './schedule';

type State = 'past' | 'now' | 'next';

/**
 * Der Tag als Linie (Designrichtung „Raum“, D-045): die Stunden von heute untereinander, Vergangenes gedämpft,
 * die laufende Stunde hervorgehoben, dazwischen die „Jetzt“-Marke. Erscheint nur in dieser Richtung und nur,
 * wenn für heute Stunden eingetragen sind. Die Marke trägt Text, nicht nur eine Linie.
 */
export function DayLine() {
  const design = useDesign();
  const { status, entries, weekAnchor, now } = usePlanner();
  const { subjects } = useWorkspace();
  if (design !== 'raum' || status !== 'ready') return null;

  const lessons = lessonsOn(entries, localDate(now), weekAnchor);
  if (lessons.length === 0) return null;

  const minutes = minutesOfDay(now);
  const stateOf = (start: string, end: string): State =>
    toMinutes(end) <= minutes ? 'past' : toMinutes(start) <= minutes ? 'now' : 'next';
  const running = lessons.some((lesson) => stateOf(lesson.startTime, lesson.endTime) === 'now');
  const firstNext = lessons.findIndex(
    (lesson) => stateOf(lesson.startTime, lesson.endTime) === 'next',
  );
  const markerAt = running ? -1 : firstNext === -1 ? lessons.length : firstNext;
  const d = m.planning.dayLine;
  const clock = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

  const items = lessons.flatMap((lesson, index) => {
    const state = stateOf(lesson.startTime, lesson.endTime);
    const subject = subjects.find((entry) => entry.id === lesson.subjectId);
    const rows = [];
    if (index === markerAt) rows.push(marker(clock, d.now));
    rows.push(
      <li
        key={lesson.id}
        data-subj={subjectColorAttr(subject?.color)}
        data-state={state}
        aria-current={state === 'now' ? 'time' : undefined}
        className="rm-day-item"
      >
        <time className="rm-day-time tabular-nums">
          {lesson.startTime}
          <span className="sr-only"> – {lesson.endTime}</span>
        </time>
        <span className="min-w-0">
          <span className="rm-day-name block truncate font-heading text-lg tracking-[-0.1px]">
            {subject?.name ?? m.planning.timetable.noSubject}
          </span>
          <span className="block truncate text-sm text-ink-muted">
            {[
              lesson.room ? format(m.planning.nextUp.lessonNowRoom, { room: lesson.room }) : null,
              state === 'now'
                ? format(d.minutesLeft, {
                    minutes: toMinutes(lesson.endTime) - minutes,
                  })
                : null,
              state === 'past' ? d.done : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      </li>,
    );
    return rows;
  });
  if (markerAt === lessons.length) items.push(marker(clock, d.now));

  return (
    <section className="rm-day mo-rise mo-i-3 mt-12" aria-labelledby="day-line-heading">
      <h2 id="day-line-heading" className={`mb-3.5 ${sectionTitle}`}>
        {d.title}
      </h2>
      <ol className="rm-day-list">{items}</ol>
    </section>
  );
}

function marker(clock: string, label: string) {
  return (
    <li key="now" className="rm-day-now">
      <span className="rm-day-now-label">
        {label} <span className="tabular-nums">{clock}</span>
      </span>
    </li>
  );
}
