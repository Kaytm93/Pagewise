import type { Exam, TimetableEntry } from '../api/types';
import {
  addDays,
  appliesInWeek,
  daysBetween,
  localDate,
  minutesOfDay,
  toMinutes,
  type WeekAnchor,
  weekdayOf,
  weekKindOf,
} from './dates';

/** Die Stunden eines Tages in zeitlicher Reihenfolge, nur solche, die in der Woche dieses Tages gelten. */
export function lessonsOn(
  entries: TimetableEntry[],
  date: string,
  anchor: WeekAnchor | null,
): TimetableEntry[] {
  const weekday = weekdayOf(date);
  const current = weekKindOf(date, anchor);
  return entries
    .filter((entry) => entry.weekday === weekday && appliesInWeek(entry.week, current))
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime));
}

export interface CurrentLesson {
  lesson: TimetableEntry;
  minutesLeft: number;
}

/** Die Stunde, die jetzt läuft (Anfang eingeschlossen, Ende ausgeschlossen), oder `null`. */
export function currentLesson(
  entries: TimetableEntry[],
  now: Date,
  anchor: WeekAnchor | null,
): CurrentLesson | null {
  const minutes = minutesOfDay(now);
  for (const lesson of lessonsOn(entries, localDate(now), anchor)) {
    if (toMinutes(lesson.startTime) <= minutes && minutes < toMinutes(lesson.endTime)) {
      return { lesson, minutesLeft: toMinutes(lesson.endTime) - minutes };
    }
  }
  return null;
}

export interface UpcomingLesson {
  lesson: TimetableEntry;
  date: string;
  /** Ganze Tage von heute bis zu dieser Stunde (0 = heute). */
  inDays: number;
  /** Minuten bis zum Beginn, nur für heute. */
  startsInMinutes: number | null;
}

/** Die nächste Stunde, die noch nicht begonnen hat: heute nach jetzt, sonst an einem der nächsten 14 Tage. */
export function nextLesson(
  entries: TimetableEntry[],
  now: Date,
  anchor: WeekAnchor | null,
): UpcomingLesson | null {
  const today = localDate(now);
  const minutes = minutesOfDay(now);
  for (let offset = 0; offset <= 14; offset += 1) {
    const date = addDays(today, offset);
    for (const lesson of lessonsOn(entries, date, anchor)) {
      if (offset === 0 && toMinutes(lesson.startTime) <= minutes) continue;
      return {
        lesson,
        date,
        inDays: offset,
        startsInMinutes: offset === 0 ? toMinutes(lesson.startTime) - minutes : null,
      };
    }
  }
  return null;
}

/** Wie viele Stunden heute noch kommen (laufende eingeschlossen). */
export function lessonsLeftToday(
  entries: TimetableEntry[],
  now: Date,
  anchor: WeekAnchor | null,
): number {
  const minutes = minutesOfDay(now);
  return lessonsOn(entries, localDate(now), anchor).filter(
    (lesson) => toMinutes(lesson.endTime) > minutes,
  ).length;
}

/** Überschneiden sich zwei Stunden (gleicher Tag, Wochenarten, die zusammen vorkommen können, und die Zeit)? */
export function overlaps(a: TimetableEntry, b: TimetableEntry): boolean {
  if (a.id === b.id || a.weekday !== b.weekday) return false;
  const together = a.week === 'all' || b.week === 'all' || a.week === b.week;
  if (!together) return false;
  return (
    toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime)
  );
}

/** Alle Stunden, mit denen sich `entry` überschneidet. */
export function overlapping(entry: TimetableEntry, entries: TimetableEntry[]): TimetableEntry[] {
  return entries.filter((other) => overlaps(entry, other));
}

export interface ExamGroups {
  /** Heute und später, das nächste zuerst. */
  upcoming: Exam[];
  /** Früher als heute, das jüngste zuerst. */
  past: Exam[];
}

function examKey(exam: Exam): string {
  return `${exam.date} ${exam.time ?? '00:00'}`;
}

export function groupExams(exams: Exam[], today: string): ExamGroups {
  const sorted = [...exams].sort((a, b) => examKey(a).localeCompare(examKey(b)));
  return {
    upcoming: sorted.filter((exam) => exam.date >= today),
    past: sorted.filter((exam) => exam.date < today).reverse(),
  };
}

/** Tage von heute bis zu einem Datum. */
export function daysUntil(date: string, today: string): number {
  return daysBetween(today, date);
}
