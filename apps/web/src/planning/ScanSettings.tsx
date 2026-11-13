import { useState } from 'react';
import type { ScanAbbreviation, ScanPeriodSchedule, ScanPeriodTime } from '../api/types';
import { format, messages as m } from '../i18n';
import { useSession } from '../session/SessionProvider';
import { Button } from '../ui/Button';
import { CheckField } from '../ui/Field';
import { FieldError } from '../ui/FieldError';
import { disclosure } from '../ui/styles';
import { periodsFromSchedule } from './scan-schedule';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const MAX_PERIODS = 16;
const MAX_ABBREVIATIONS = 100;
const cell =
  'min-h-10 w-full rounded-control border border-control-edge bg-sheet px-2 text-sm text-ink disabled:opacity-60';
const label = 'block text-sm font-medium text-ink';

/** Ganze Zahl aus einem Zahlenfeld; leer oder ungültig wird 0 (die Prüfung meldet das). */
function whole(value: string): number {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : 0;
}

function isValid(schedule: ScanPeriodSchedule, rows: readonly ScanPeriodTime[]): boolean {
  const afters = schedule.breaks.map((entry) => entry.after);
  return (
    schedule.count >= 1 &&
    schedule.count <= MAX_PERIODS &&
    schedule.lessonMinutes >= 5 &&
    schedule.gapMinutes >= 0 &&
    schedule.breaks.every((entry) => entry.minutes >= 0 && entry.after >= 1) &&
    new Set(afters).size === afters.length &&
    afters.every((after) => after < schedule.count) &&
    rows.length === schedule.count
  );
}

/**
 * Stundentafel als Regel: Unterrichtsbeginn, Stundenlänge, normale und lange Pausen. Die Zeiten
 * aller Stunden der Woche rechnet Pagewise daraus; jede Änderung zeigt sich sofort in der Liste.
 */
export function ScheduleEditor({ onSaved }: { onSaved?: (periods: ScanPeriodTime[]) => void }) {
  const { api } = useSession();
  const t = m.planning.timetableScan;
  const [schedule, setSchedule] = useState<ScanPeriodSchedule | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  const rows = schedule ? periodsFromSchedule(schedule) : [];
  const valid = schedule !== null && isValid(schedule, rows);
  const busy = state === 'saving';

  async function load() {
    try {
      setSchedule((await api.timetableScanPeriods()).schedule);
    } catch {
      setState('failed');
    }
  }

  function change(patch: Partial<ScanPeriodSchedule>) {
    setSchedule((current) => (current ? { ...current, ...patch } : current));
    setState('idle');
  }

  function changeBreak(index: number, patch: Partial<ScanPeriodSchedule['breaks'][number]>) {
    if (!schedule) return;
    change({
      breaks: schedule.breaks.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
    });
  }

  function addBreak() {
    if (!schedule) return;
    const used = new Set(schedule.breaks.map((entry) => entry.after));
    let after = 1;
    while (used.has(after) && after < schedule.count - 1) after += 1;
    change({ breaks: [...schedule.breaks, { after, minutes: 20 }] });
  }

  async function save() {
    if (!schedule || !valid) return;
    setState('saving');
    try {
      const saved = await api.setTimetableScanPeriods({
        ...schedule,
        breaks: [...schedule.breaks].sort((a, b) => a.after - b.after),
      });
      setSchedule(saved.schedule);
      setState('saved');
      onSaved?.(saved.periods);
    } catch {
      setState('failed');
    }
  }

  return (
    <details
      onToggle={(event) => {
        const open = (event.target as HTMLDetailsElement).open;
        if (open && schedule === null && state !== 'failed') void load();
      }}
    >
      <summary className={disclosure}>{t.periodsTitle}</summary>
      <div className="mt-2 space-y-3">
        <p className="text-sm text-ink-secondary">{t.periodsHint}</p>
        {schedule === null ? (
          <p role="status" className="text-sm text-ink-muted">
            {state === 'failed' ? t.periodsFailed : t.periodsLoading}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className={label}>
                {t.scheduleStart}
                <input
                  type="time"
                  value={schedule.start}
                  disabled={busy}
                  onChange={(event) => change({ start: event.target.value })}
                  className={`${cell} mt-1`}
                />
              </label>
              <label className={label}>
                {t.scheduleLesson}
                <input
                  type="number"
                  min={5}
                  max={240}
                  value={schedule.lessonMinutes}
                  disabled={busy}
                  onChange={(event) => change({ lessonMinutes: whole(event.target.value) })}
                  className={`${cell} mt-1`}
                />
              </label>
              <label className={label}>
                {t.scheduleGap}
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={schedule.gapMinutes}
                  disabled={busy}
                  onChange={(event) => change({ gapMinutes: whole(event.target.value) })}
                  className={`${cell} mt-1`}
                />
              </label>
              <label className={label}>
                {t.scheduleCount}
                <input
                  type="number"
                  min={1}
                  max={MAX_PERIODS}
                  value={schedule.count}
                  disabled={busy}
                  onChange={(event) => change({ count: whole(event.target.value) })}
                  className={`${cell} mt-1`}
                />
              </label>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">{t.breaksTitle}</p>
              <p className="text-sm text-ink-secondary">{t.breaksHint}</p>
              {schedule.breaks.length === 0 && (
                <p className="text-sm text-ink-muted">{t.breaksEmpty}</p>
              )}
              <ul className="space-y-1">
                {schedule.breaks.map((entry, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Pausen haben keine eigene Kennung
                  <li key={index} className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={MAX_PERIODS - 1}
                      aria-label={`${t.breakAfter} ${index + 1}`}
                      value={entry.after}
                      disabled={busy}
                      onChange={(event) => changeBreak(index, { after: whole(event.target.value) })}
                      className={`${cell} w-20`}
                    />
                    <input
                      type="number"
                      min={0}
                      max={240}
                      aria-label={`${t.breakMinutes} ${index + 1}`}
                      value={entry.minutes}
                      disabled={busy}
                      onChange={(event) =>
                        changeBreak(index, { minutes: whole(event.target.value) })
                      }
                      className={`${cell} w-20`}
                    />
                    <Button
                      variant="secondary"
                      disabled={busy}
                      aria-label={`${t.breakRemove} ${index + 1}`}
                      onClick={() =>
                        change({ breaks: schedule.breaks.filter((_, at) => at !== index) })
                      }
                    >
                      ×
                    </Button>
                  </li>
                ))}
              </ul>
              <Button
                variant="secondary"
                disabled={busy || schedule.breaks.length >= schedule.count - 1}
                onClick={addBreak}
              >
                {t.breakAdd}
              </Button>
            </div>
            <CheckField
              label={t.mergeDoubles}
              hint={t.mergeDoublesHint}
              checked={schedule.mergeDoubles}
              onChange={(mergeDoubles) => change({ mergeDoubles })}
            />
            {valid ? (
              <div>
                <p className="text-sm text-ink-secondary">{t.schedulePreview}</p>
                <ul className="mt-1 grid gap-x-4 text-sm text-ink sm:grid-cols-2">
                  {rows.map((row) => (
                    <li key={row.period}>
                      {format(t.periodRow, {
                        period: row.period,
                        from: row.startTime,
                        to: row.endTime,
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <FieldError>{t.scheduleInvalid}</FieldError>
            )}
            <div className="flex items-center gap-3">
              <Button variant="secondary" onClick={() => void save()} disabled={busy || !valid}>
                {busy ? t.periodsSaving : t.periodsSave}
              </Button>
              {state === 'saved' && (
                <p role="status" className="text-sm text-ink-secondary">
                  {t.periodsSaved}
                </p>
              )}
              {state === 'failed' && <FieldError>{t.periodsFailed}</FieldError>}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

/** Eigene Kürzel („bsp = Beispielfach“) für Kurscodes, die Pagewise nicht von selbst kennt. */
export function AbbreviationsEditor() {
  const { api } = useSession();
  const t = m.planning.timetableScan;
  const [rows, setRows] = useState<ScanAbbreviation[] | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  const busy = state === 'saving';

  async function load() {
    try {
      setRows(await api.timetableScanAbbreviations());
    } catch {
      setState('failed');
    }
  }

  function change(index: number, patch: Partial<ScanAbbreviation>) {
    setRows((current) =>
      current ? current.map((row, at) => (at === index ? { ...row, ...patch } : row)) : current,
    );
    setState('idle');
  }

  async function save() {
    if (!rows) return;
    setState('saving');
    try {
      const filled = rows.filter((row) => row.code.trim() !== '' && row.subject.trim() !== '');
      setRows(await api.setTimetableScanAbbreviations(filled));
      setState('saved');
    } catch {
      setState('failed');
    }
  }

  return (
    <details
      onToggle={(event) => {
        const open = (event.target as HTMLDetailsElement).open;
        if (open && rows === null && state !== 'failed') void load();
      }}
    >
      <summary className={disclosure}>{t.abbreviationsTitle}</summary>
      <div className="mt-2 space-y-2">
        <p className="text-sm text-ink-secondary">{t.abbreviationsHint}</p>
        {rows === null ? (
          <p role="status" className="text-sm text-ink-muted">
            {state === 'failed' ? t.abbreviationsFailed : t.abbreviationsLoading}
          </p>
        ) : (
          <>
            {rows.length === 0 && <p className="text-sm text-ink-muted">{t.abbreviationsEmpty}</p>}
            <ul className="space-y-1">
              {rows.map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Zeilen haben keine eigene Kennung
                <li key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    aria-label={`${t.abbreviationCode} ${index + 1}`}
                    value={row.code}
                    maxLength={24}
                    disabled={busy}
                    onChange={(event) => change(index, { code: event.target.value })}
                    className={`${cell} w-28`}
                  />
                  <input
                    type="text"
                    aria-label={`${t.abbreviationSubject} ${index + 1}`}
                    value={row.subject}
                    maxLength={80}
                    disabled={busy}
                    onChange={(event) => change(index, { subject: event.target.value })}
                    className={cell}
                  />
                  <Button
                    variant="secondary"
                    disabled={busy}
                    aria-label={`${t.abbreviationRemove} ${index + 1}`}
                    onClick={() => {
                      setRows(rows.filter((_, at) => at !== index));
                      setState('idle');
                    }}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                disabled={busy || rows.length >= MAX_ABBREVIATIONS}
                onClick={() => setRows([...rows, { code: '', subject: '' }])}
              >
                {t.abbreviationAdd}
              </Button>
              <Button variant="secondary" onClick={() => void save()} disabled={busy}>
                {busy ? t.abbreviationsSaving : t.abbreviationsSave}
              </Button>
              {state === 'saved' && (
                <p role="status" className="text-sm text-ink-secondary">
                  {t.abbreviationsSaved}
                </p>
              )}
              {state === 'failed' && <FieldError>{t.abbreviationsFailed}</FieldError>}
            </div>
          </>
        )}
      </div>
    </details>
  );
}
