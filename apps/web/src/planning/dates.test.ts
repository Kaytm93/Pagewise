import { describe, expect, it } from 'vitest';
import {
  addDays,
  appliesInWeek,
  daysBetween,
  formatDate,
  isValidDate,
  localDate,
  minutesOfDay,
  mondayOf,
  toMinutes,
  weekdayOf,
  weekKindOf,
} from './dates';

describe('Datum und Zeit', () => {
  it('prüft Daten gegen den Kalender', () => {
    expect(isValidDate('2026-10-04')).toBe(true);
    expect(isValidDate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-29', '2026-13-01', '1999-12-31', '2026-1-4', '04.10.2026', '']) {
      expect(isValidDate(bad), bad).toBe(false);
    }
  });

  it('kennt Wochentag und Montag der Woche', () => {
    expect(weekdayOf('2026-10-05')).toBe(1);
    expect(weekdayOf('2026-10-11')).toBe(7);
    expect(mondayOf('2026-10-11')).toBe('2026-10-05');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
  });

  it('rechnet über die Zeitumstellung ohne Verschiebung', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-04', '2026-10-08')).toBe(4);
    expect(daysBetween('2026-10-08', '2026-10-04')).toBe(-4);
  });

  it('nimmt als heute das lokale Datum und rechnet Minuten seit Mitternacht', () => {
    expect(localDate(new Date(2026, 9, 4, 23, 30))).toBe('2026-10-04');
    expect(minutesOfDay(new Date(2026, 9, 4, 9, 50))).toBe(590);
    expect(toMinutes('09:50')).toBe(590);
    expect(toMinutes('00:00')).toBe(0);
  });

  it('wechselt die Wochenart jede Woche, auch rückwärts und über den Jahreswechsel', () => {
    const anchor = { monday: '2026-10-05', week: 'a' } as const;
    expect(weekKindOf('2026-10-07', null)).toBeNull();
    expect(weekKindOf('2026-10-11', anchor)).toBe('a');
    expect(weekKindOf('2026-10-12', anchor)).toBe('b');
    expect(weekKindOf('2026-09-28', anchor)).toBe('b');
    expect(weekKindOf('2027-01-04', anchor)).toBe('b');
    expect(appliesInWeek('a', 'b')).toBe(false);
    expect(appliesInWeek('a', null)).toBe(true);
    expect(appliesInWeek('all', 'b')).toBe(true);
  });

  it('zeigt Daten deutsch an', () => {
    expect(formatDate('2026-10-08')).toBe('8. Oktober');
    expect(formatDate('2026-10-08', 'long')).toBe('Donnerstag, 8. Oktober');
    expect(formatDate('2026-10-08', 'short')).toMatch(/Do\.?,? 8\.10\./);
  });
});
