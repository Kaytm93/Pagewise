import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULE,
  isValidSchedule,
  type PeriodSchedule,
  periodsFromSchedule,
  scheduleFromPeriods,
} from './periods';

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
