import { Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { TimetableEntry } from '../api/types';
import { format, messages as m } from '../i18n';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { Sheet } from '../ui/Sheet';
import { sectionTitle } from '../ui/styles';
import { subjectColorAttr } from '../ui/subject-color';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { appliesInWeek, localDate, weekdayOf, weekKindOf } from './dates';
import { LessonDialog } from './LessonDialog';
import { usePlanner } from './PlannerProvider';
import { currentLesson, overlapping } from './schedule';

type Filter = 'all' | 'a' | 'b';
type Dialog = { entry?: TimetableEntry; weekday?: number } | null;

const COLUMN_CLASS: Record<number, string> = {
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
  7: 'lg:grid-cols-7',
};

function WeekControls({ filter, onFilter }: { filter: Filter; onFilter: (value: Filter) => void }) {
  const { weekAnchor, now, setWeek } = usePlanner();
  const t = m.planning.timetable;
  const today = localDate(now);
  const current = weekKindOf(today, weekAnchor);
  const [failed, setFailed] = useState(false);

  async function choose(value: 'a' | 'b' | 'none') {
    setFailed(false);
    try {
      await setWeek(value === 'none' ? null : { date: today, week: value });
    } catch {
      setFailed(true);
    }
  }

  return (
    <section
      aria-labelledby="week-heading"
      className="mo-rise mo-i-1 mt-8 grid gap-6 sm:grid-cols-2"
    >
      <div>
        <h2 id="week-heading" className={sectionTitle}>
          {t.weekTitle}
        </h2>
        <p className="mt-1.5 mb-3 max-w-[44ch] text-sm text-ink-muted">{t.weekLead}</p>
        <Segmented
          legend={t.weekNow}
          value={current ?? 'none'}
          onChange={(value) => void choose(value)}
          options={[
            { value: 'a', label: t.weekOptions.a },
            { value: 'b', label: t.weekOptions.b },
            { value: 'none', label: t.weekOptions.none },
          ]}
        />
        {failed && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {t.weekFailed}
          </p>
        )}
      </div>
      <div>
        <h2 className={sectionTitle}>{t.weekFilter}</h2>
        <div className="mt-3">
          <Segmented
            legend={t.weekFilter}
            value={filter}
            onChange={onFilter}
            options={[
              { value: 'all', label: t.weekFilterOptions.all },
              { value: 'a', label: t.weekFilterOptions.a },
              { value: 'b', label: t.weekFilterOptions.b },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function LessonCard({
  entry,
  shown,
  running,
  minutesLeft,
  onOpen,
}: {
  entry: TimetableEntry;
  shown: TimetableEntry[];
  running: boolean;
  minutesLeft: number | null;
  onOpen: () => void;
}) {
  const { subjects } = useWorkspace();
  const t = m.planning.timetable;
  const subject = subjects.find((item) => item.id === entry.subjectId);
  const name = subject?.name ?? t.noSubject;
  const clashes = overlapping(entry, shown);
  const clashNames = clashes
    .map((other) => subjects.find((item) => item.id === other.subjectId)?.name ?? t.noSubject)
    .join(', ');
  return (
    <li data-subj={subjectColorAttr(subject?.color)}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={format(t.editNamed, { name: `${name}, ${entry.startTime}–${entry.endTime}` })}
        aria-current={running ? 'time' : undefined}
        className="lg-row w-full rounded-[10px] border border-line-warm bg-sheet px-3.5 py-3 text-left text-ink hover:bg-sheet"
      >
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm text-ink-muted tabular-nums">
          <span>
            {entry.startTime}–{entry.endTime}
          </span>
          {running && (
            <span className="font-medium text-ink">
              {t.now}
              {minutesLeft !== null && `, ${format(t.leftMinutes, { minutes: minutesLeft })}`}
            </span>
          )}
        </span>
        <span className="mt-0.5 block font-heading text-lg leading-snug tracking-[-0.2px] break-words">
          {name}
        </span>
        {(entry.room || entry.week !== 'all') && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-ink-muted">
            {entry.room && <span>{entry.room}</span>}
            {entry.week !== 'all' && (
              <span className="rounded-pill bg-paper px-2 py-0.5 text-meta">
                {t.weekBadge[entry.week]}
              </span>
            )}
          </span>
        )}
        {entry.note && <span className="mt-1 block text-sm text-ink-secondary">{entry.note}</span>}
        {clashes.length > 0 && (
          <span className="mt-1.5 flex items-start gap-1.5 text-sm text-ink-secondary">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {format(t.overlap, { names: clashNames })}
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * Der Stundenplan: je Wochentag eine Spalte (am Handy ein Tag nach Wahl), die laufende Stunde ist markiert.
 * Die Zeiten sind frei; Stunden nur für A- oder B-Wochen lassen sich nach der Wochenart filtern.
 */
export function TimetablePage() {
  const { status, entries, weekAnchor, now, reload } = usePlanner();
  const t = m.planning.timetable;
  const today = localDate(now);
  const todayWeekday = weekdayOf(today);
  const currentWeek = weekKindOf(today, weekAnchor);
  const [filter, setFilter] = useState<Filter>(currentWeek ?? 'all');
  const [selectedDay, setSelectedDay] = useState(todayWeekday <= 5 ? todayWeekday : 1);
  const [dialog, setDialog] = useState<Dialog>(null);

  const days = [
    1,
    2,
    3,
    4,
    5,
    ...(entries.some((e) => e.weekday === 6) ? [6] : []),
    ...(entries.some((e) => e.weekday === 7) ? [7] : []),
  ];
  const view = filter === 'all' ? null : filter;
  const visible = entries.filter((entry) => appliesInWeek(entry.week, view));
  const running = currentLesson(entries, now, weekAnchor);
  const showWeekControls = weekAnchor !== null || entries.some((entry) => entry.week !== 'all');

  return (
    <Sheet width="wide">
      <h1 className="mo-rise font-heading text-[clamp(34px,5.4vw,52px)] leading-[1.1] tracking-[-0.025em]">
        {t.title}
      </h1>
      <p className="mo-rise mo-i-1 mt-3 max-w-[60ch] text-ink-secondary">{t.lead}</p>

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
            <Button variant="primary" onClick={() => setDialog({ weekday: selectedDay })}>
              <Plus aria-hidden="true" className="size-4" />
              {t.add}
            </Button>
          </div>

          {entries.length === 0 ? (
            <div className="mt-8 rounded-box bg-paper p-4">
              <p className="font-medium">{t.emptyTitle}</p>
              <p className="mt-1 text-sm text-ink-secondary">{t.emptyHint}</p>
            </div>
          ) : (
            <>
              {showWeekControls && <WeekControls filter={filter} onFilter={setFilter} />}

              <fieldset className="m-0 mt-8 mb-3 flex min-w-0 gap-1 border-0 p-0 lg:hidden">
                <legend className="sr-only">{t.dayTabs}</legend>
                {days.map((day) => (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={selectedDay === day}
                    onClick={() => setSelectedDay(day)}
                    className={`mo-press min-h-11 flex-1 rounded-[10px] border text-sm ${
                      selectedDay === day
                        ? 'border-line-warm bg-sheet font-medium text-ink'
                        : 'border-transparent text-ink-secondary'
                    }`}
                  >
                    {m.planning.daysShort[day - 1]}
                  </button>
                ))}
              </fieldset>

              <div
                className={`mt-2 gap-4 lg:mt-8 lg:grid ${COLUMN_CLASS[days.length] ?? 'lg:grid-cols-5'}`}
              >
                {days.map((day) => {
                  const lessons = visible.filter((entry) => entry.weekday === day);
                  return (
                    <section
                      key={day}
                      aria-labelledby={`day-${day}`}
                      className={selectedDay === day ? 'min-w-0' : 'hidden min-w-0 lg:block'}
                    >
                      <h2
                        id={`day-${day}`}
                        className="mb-2 flex items-baseline gap-2 font-heading text-lg"
                      >
                        {m.planning.days[day - 1]}
                        {day === todayWeekday && (
                          <span className="font-sans text-meta text-ink-muted">{t.today}</span>
                        )}
                      </h2>
                      {lessons.length === 0 ? (
                        <p className="text-sm text-ink-muted">{t.emptyDay}</p>
                      ) : (
                        <ul className="space-y-2">
                          {lessons.map((entry) => (
                            <LessonCard
                              key={entry.id}
                              entry={entry}
                              shown={lessons}
                              running={running?.lesson.id === entry.id}
                              minutesLeft={
                                running?.lesson.id === entry.id ? running.minutesLeft : null
                              }
                              onOpen={() => setDialog({ entry })}
                            />
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
      {dialog && (
        <LessonDialog
          entry={dialog.entry}
          weekday={dialog.weekday}
          onClose={() => setDialog(null)}
        />
      )}
    </Sheet>
  );
}
