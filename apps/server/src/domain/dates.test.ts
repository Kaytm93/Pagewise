import { describe, expect, it } from 'vitest';
import {
  addDays,
  appliesInWeek,
  daysBetween,
  isValidDate,
  isValidTime,
  localDate,
  mondayOf,
  weekdayOf,
  weekKindOf,
} from './dates';

describe('Datum und Uhrzeit prüfen', () => {
  it.each([
    ['2026-10-04', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['2026-00-10', false],
    ['2026-04-31', false],
    ['1999-12-31', false],
    ['2101-01-01', false],
    ['2026-1-4', false],
    ['04.10.2026', false],
    ['', false],
  ])('Datum %j ist %s', (value, valid) => {
    expect(isValidDate(value)).toBe(valid);
  });

  it.each([
    ['00:00', true],
    ['07:55', true],
    ['23:59', true],
    ['24:00', false],
    ['7:55', false],
    ['12:60', false],
    ['12:5', false],
  ])('Uhrzeit %j ist %s', (value, valid) => {
    expect(isValidTime(value)).toBe(valid);
  });
});

describe('Rechnen mit Daten', () => {
  it('kennt den Wochentag (1 = Montag, 7 = Sonntag)', () => {
    expect(weekdayOf('2026-10-05')).toBe(1);
    expect(weekdayOf('2026-10-08')).toBe(4);
    expect(weekdayOf('2026-10-11')).toBe(7);
  });

  it('findet den Montag der Woche, auch am Sonntag und über Monats- und Jahresgrenzen', () => {
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
    expect(mondayOf('2026-10-11')).toBe('2026-10-05');
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
  });

  it('addiert Tage über die Zeitumstellung hinweg ohne Verschiebung', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('zählt Tage zwischen Daten, auch negativ', () => {
    expect(daysBetween('2026-10-04', '2026-10-04')).toBe(0);
    expect(daysBetween('2026-10-04', '2026-10-08')).toBe(4);
    expect(daysBetween('2026-10-08', '2026-10-04')).toBe(-4);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('nimmt als „heute“ das lokale Datum, nicht das UTC-Datum', () => {
    // 23:30 Uhr lokal: in UTC wäre es je nach Zone schon der nächste oder noch der gleiche Tag.
    expect(localDate(new Date(2026, 9, 4, 23, 30))).toBe('2026-10-04');
    expect(localDate(new Date(2026, 9, 5, 0, 5))).toBe('2026-10-05');
  });
});

describe('Wochenart A und B', () => {
  const anchor = { monday: '2026-10-05', week: 'a' } as const;

  it('ist ohne Festlegung unbekannt, und dann gelten alle Einträge', () => {
    expect(weekKindOf('2026-10-07', null)).toBeNull();
    expect(appliesInWeek('a', null)).toBe(true);
    expect(appliesInWeek('b', null)).toBe(true);
  });

  it('wechselt jede Woche, in der festgelegten Woche und in der Folgewoche', () => {
    expect(weekKindOf('2026-10-05', anchor)).toBe('a');
    expect(weekKindOf('2026-10-11', anchor)).toBe('a');
    expect(weekKindOf('2026-10-12', anchor)).toBe('b');
    expect(weekKindOf('2026-10-19', anchor)).toBe('a');
  });

  it('rechnet auch rückwärts und über den Jahreswechsel richtig', () => {
    expect(weekKindOf('2026-09-28', anchor)).toBe('b');
    expect(weekKindOf('2026-09-21', anchor)).toBe('a');
    // 12 Wochen später: gerade Zahl, also wieder A.
    expect(weekKindOf('2026-12-28', anchor)).toBe('a');
    expect(weekKindOf('2027-01-04', anchor)).toBe('b');
    expect(weekKindOf('2027-01-04', { monday: '2026-10-05', week: 'b' })).toBe('a');
  });

  it('prüft, ob ein Eintrag in der Woche gilt', () => {
    expect(appliesInWeek('all', 'a')).toBe(true);
    expect(appliesInWeek('a', 'a')).toBe(true);
    expect(appliesInWeek('a', 'b')).toBe(false);
    expect(appliesInWeek('b', 'b')).toBe(true);
  });
});
