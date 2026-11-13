import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULE,
  isValidSchedule,
  type PeriodSchedule,
  periodsFromSchedule,
  scheduleFromPeriods,
} from './periods';
import { mergeDoubleLessons } from './service';

const RULE: PeriodSchedule = {
  start: '07:45',
  lessonMinutes: 45,
  gapMinutes: 0,
  count: 4,
  breaks: [{ after: 2, minutes: 15 }],
  mergeDoubles: true,
};

describe('Stundentafel als Regel', () => {
  it('rechnet alle Stunden aus Beginn, Länge und Pausen', () => {
    expect(periodsFromSchedule(RULE)).toEqual([
      { period: 1, startTime: '07:45', endTime: '08:30' },
      { period: 2, startTime: '08:30', endTime: '09:15' },
      { period: 3, startTime: '09:30', endTime: '10:15' },
      { period: 4, startTime: '10:15', endTime: '11:00' },
    ]);
  });

  it('verschiebt mit dem Beginn die ganze Woche', () => {
    const later = periodsFromSchedule({ ...RULE, start: '08:15' });
    expect(later.map((row) => row.startTime)).toEqual(['08:15', '09:00', '10:00', '10:45']);
  });

  it('übersetzt eine alte Liste einzelner Zeiten in eine Regel', () => {
    const rows = periodsFromSchedule(RULE);
    const rule = scheduleFromPeriods(rows);
    expect(rule).toMatchObject({ start: '07:45', lessonMinutes: 45, gapMinutes: 0, count: 4 });
    expect(rule && periodsFromSchedule(rule)).toEqual(rows);
  });

  it('rechnet bei einer alten Liste ab Stunde 3 den Beginn zurück', () => {
    const rows = periodsFromSchedule(RULE).slice(2);
    const rule = scheduleFromPeriods(rows);
    const derived = periodsFromSchedule(rule);
    expect(derived.find((row) => row.period === 3)?.startTime).toBe(rows[0]?.startTime);
    expect(derived.find((row) => row.period === 4)).toEqual(rows[1]);
  });

  it('prüft Regeln', () => {
    expect(isValidSchedule(DEFAULT_SCHEDULE)).toBe(true);
    expect(isValidSchedule(RULE)).toBe(true);
    expect(isValidSchedule({ ...RULE, breaks: [{ after: 4, minutes: 10 }] })).toBe(false);
    expect(
      isValidSchedule({
        ...RULE,
        breaks: [
          { after: 1, minutes: 10 },
          { after: 1, minutes: 5 },
        ],
      }),
    ).toBe(false);
    expect(isValidSchedule({ ...RULE, start: '23:30' })).toBe(false);
    expect(isValidSchedule({ ...RULE, start: '7:45' })).toBe(false);
  });
});

describe('Doppelstunden', () => {
  const table = new Map(periodsFromSchedule(RULE).map((row) => [row.period, row]));
  const lesson = (period: number, note: string | null) => ({
    weekday: 1,
    startTime: table.get(period)?.startTime ?? '',
    endTime: table.get(period)?.endTime ?? '',
    period,
    periodEnd: null,
    code: null,
    subject: 'Beispielfach',
    room: 'Raum 1',
    note,
    week: 'all' as const,
  });

  it('fasst gleiche aufeinanderfolgende Stunden zusammen, auch in falscher Reihenfolge', () => {
    const merged = mergeDoubleLessons([lesson(2, null), lesson(1, null)], table);
    expect(merged).toEqual([{ ...lesson(1, null), endTime: '09:15', periodEnd: 2 }]);
  });

  it('lässt Stunden mit verschiedenen Bemerkungen getrennt, damit keine verloren geht', () => {
    const merged = mergeDoubleLessons([lesson(1, 'Notiz A'), lesson(2, 'Notiz B')], table);
    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.note)).toEqual(['Notiz A', 'Notiz B']);
  });
});
