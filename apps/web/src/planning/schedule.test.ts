import { describe, expect, it } from 'vitest';
import type { Exam, TimetableEntry } from '../api/types';
import {
  currentLesson,
  daysUntil,
  groupExams,
  lessonsLeftToday,
  lessonsOn,
  nextLesson,
  overlapping,
  overlaps,
} from './schedule';

const entry = (id: string, extra: Partial<TimetableEntry>): TimetableEntry => ({
  id,
  weekday: 1,
  startTime: '08:00',
  endTime: '08:45',
  subjectId: null,
  room: null,
  note: null,
  week: 'all',
  ...extra,
});

// Alle Daten sind erfunden. Montag, 5. Oktober 2026.
const entries = [
  entry('a', { startTime: '08:00', endTime: '08:45' }),
  entry('b', { startTime: '09:00', endTime: '09:45' }),
  entry('c', { startTime: '10:00', endTime: '10:45', week: 'a' }),
  entry('d', { startTime: '10:00', endTime: '10:45', week: 'b' }),
  entry('e', { weekday: 3, startTime: '09:00', endTime: '09:45' }),
];
const monday = (hours: number, minutes: number) => new Date(2026, 9, 5, hours, minutes);
const anchorA = { monday: '2026-10-05', week: 'a' } as const;

describe('Stunden eines Tages', () => {
  it('sortiert nach Beginn und beachtet die Wochenart', () => {
    expect(lessonsOn(entries, '2026-10-05', anchorA).map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(lessonsOn(entries, '2026-10-12', anchorA).map((e) => e.id)).toEqual(['a', 'b', 'd']);
    // Ohne festgelegte Woche gelten alle.
    expect(lessonsOn(entries, '2026-10-05', null).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(lessonsOn(entries, '2026-10-07', null).map((e) => e.id)).toEqual(['e']);
    expect(lessonsOn(entries, '2026-10-06', null)).toEqual([]);
  });
});

describe('Jetzt und als Nächstes', () => {
  it('findet die laufende Stunde (Anfang eingeschlossen, Ende nicht) samt Restzeit', () => {
    expect(currentLesson(entries, monday(8, 0), anchorA)).toMatchObject({
      lesson: { id: 'a' },
      minutesLeft: 45,
    });
    expect(currentLesson(entries, monday(8, 44), anchorA)).toMatchObject({
      lesson: { id: 'a' },
      minutesLeft: 1,
    });
    expect(currentLesson(entries, monday(8, 45), anchorA)).toBeNull();
    expect(currentLesson(entries, monday(9, 30), anchorA)).toMatchObject({
      lesson: { id: 'b' },
      minutesLeft: 15,
    });
    expect(currentLesson(entries, monday(7, 0), anchorA)).toBeNull();
  });

  it('findet die nächste Stunde heute, sonst die des nächsten passenden Tages', () => {
    const during = nextLesson(entries, monday(8, 10), anchorA);
    expect(during).toMatchObject({ lesson: { id: 'b' }, inDays: 0, startsInMinutes: 50 });
    const afterAll = nextLesson(entries, monday(11, 0), anchorA);
    expect(afterAll).toMatchObject({
      lesson: { id: 'e' },
      date: '2026-10-07',
      inDays: 2,
      startsInMinutes: null,
    });
    // Nach der letzten Stunde der Woche: Montag der nächsten Woche (B-Woche mit „d“, dazu „a“ zuerst).
    const nextWeek = nextLesson(entries, new Date(2026, 9, 7, 12, 0), anchorA);
    expect(nextWeek).toMatchObject({ lesson: { id: 'a' }, date: '2026-10-12', inDays: 5 });
    expect(nextLesson([], monday(8, 0), null)).toBeNull();
  });

  it('zählt die Stunden, die heute noch kommen', () => {
    expect(lessonsLeftToday(entries, monday(7, 0), anchorA)).toBe(3);
    expect(lessonsLeftToday(entries, monday(8, 30), anchorA)).toBe(3);
    expect(lessonsLeftToday(entries, monday(8, 45), anchorA)).toBe(2);
    expect(lessonsLeftToday(entries, monday(18, 0), anchorA)).toBe(0);
  });
});

describe('Überschneidungen', () => {
  it('erkennt Überschneidungen am gleichen Tag, nicht bei Berührung oder verschiedenen Wochenarten', () => {
    const x = entry('x', { startTime: '08:30', endTime: '09:15' });
    expect(overlaps(entries[0] as TimetableEntry, x)).toBe(true);
    expect(overlaps(entries[1] as TimetableEntry, x)).toBe(true);
    // 08:45 bis 09:00 liegt zwischen den Stunden; Aneinanderstoßen zählt nicht.
    expect(
      overlaps(
        entries[0] as TimetableEntry,
        entry('y', { startTime: '08:45', endTime: '09:30', id: 'y' }),
      ),
    ).toBe(false);
    expect(overlaps(entries[2] as TimetableEntry, entries[3] as TimetableEntry)).toBe(false);
    expect(
      overlaps(
        entries[2] as TimetableEntry,
        entry('z', { startTime: '10:30', endTime: '11:00', week: 'all' }),
      ),
    ).toBe(true);
    expect(overlaps(entries[0] as TimetableEntry, entries[4] as TimetableEntry)).toBe(false);
    expect(overlaps(x, x)).toBe(false);
    expect(overlapping(x, entries).map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('Tests nach Datum gruppieren', () => {
  const exam = (id: string, date: string, time: string | null = null): Exam => ({
    id,
    subjectId: 's',
    kind: 'Test',
    title: null,
    date,
    time,
    topics: null,
    notes: null,
  });

  it('trennt anstehende (ab heute) von vergangenen und sortiert beide sinnvoll', () => {
    const groups = groupExams(
      [
        exam('1', '2026-10-20'),
        exam('2', '2026-10-04', '14:00'),
        exam('3', '2026-10-04', '08:00'),
        exam('4', '2026-09-01'),
        exam('5', '2026-10-01'),
      ],
      '2026-10-04',
    );
    expect(groups.upcoming.map((e) => e.id)).toEqual(['3', '2', '1']);
    expect(groups.past.map((e) => e.id)).toEqual(['5', '4']);
  });

  it('zählt die Tage bis zu einem Datum', () => {
    expect(daysUntil('2026-10-08', '2026-10-04')).toBe(4);
    expect(daysUntil('2026-10-04', '2026-10-04')).toBe(0);
    expect(daysUntil('2026-10-01', '2026-10-04')).toBe(-3);
  });
});
