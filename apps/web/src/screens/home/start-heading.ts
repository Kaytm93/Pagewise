import type { Exam, TimetableEntry, WeekAnchor } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { localDate, minutesOfDay, toMinutes } from '../../planning/dates';
import { relativeDay } from '../../planning/labels';
import { daysUntil, groupExams, lessonsOn } from '../../planning/schedule';

export interface StartHeadingInput {
  /** „Heute“ als Datum `JJJJ-MM-TT`. */
  today: string;
  /** Wie viele Stunden heute im Plan stehen. */
  lessonsToday: number;
  /** Davon noch nicht zu Ende (die laufende zählt mit). */
  lessonsLeft: number;
  /** Der nächste Test ab heute, sonst `null`. `subject` ist `null`, wenn das Fach unbekannt ist. */
  exam: { kind: string; subject: string | null; date: string } | null;
}

function lessonPart(total: number, left: number): string | null {
  const e = m.home.headline;
  if (total <= 0) return null;
  if (left <= 0) return e.over;
  if (left < total) return left === 1 ? e.left.one : format(e.left.many, { count: left });
  return total === 1 ? e.today.one : format(e.today.many, { count: total });
}

/**
 * Ein Satz für die Überschrift der Startseite, z. B. „Heute 4 Stunden, Schulaufgabe Chemie in 3 Tagen.“
 * Ohne Stunden und ohne Test (oder wenn beides nicht verwertbar ist) gibt es `null`: dann gilt der
 * feste Text aus `m.home.heading`.
 */
export function startHeading(input: StartHeadingInput): string | null {
  const e = m.home.headline;
  const lessons = lessonPart(input.lessonsToday, input.lessonsLeft);
  const exam = input.exam;
  const examLabel = exam
    ? format(e.exam, { kind: exam.kind.trim(), subject: exam.subject?.trim() ?? '' }).trim()
    : '';
  const days = exam ? daysUntil(exam.date, input.today) : -1;
  const hasExam = exam !== null && examLabel !== '' && days >= 0;

  if (lessons && hasExam) {
    if (days === 0) {
      // Ist heute schon alles vorbei, steht der Test nicht mehr „vor“ einem.
      return input.lessonsLeft <= 0
        ? format(e.lessonsOnly, { lessons })
        : format(e.lessonsAndExamToday, { lessons, exam: examLabel });
    }
    return format(e.lessonsAndExam, {
      lessons,
      exam: examLabel,
      when: relativeDay(exam.date, input.today),
    });
  }
  if (lessons) return format(e.lessonsOnly, { lessons });
  if (hasExam) {
    return format(e.examOnly, { exam: examLabel, when: relativeDay(exam.date, input.today) });
  }
  return null;
}

/**
 * Wie `startHeading`, aber aus den Daten, die die Startseite schon hat (Stundenplan, Tests, Fächer).
 * Fragt nichts beim Server ab.
 */
export function startHeadingFor(data: {
  entries: TimetableEntry[];
  exams: Exam[];
  weekAnchor: WeekAnchor | null;
  now: Date;
  subjectName: (id: string) => string | null;
}): string | null {
  const today = localDate(data.now);
  const minutes = minutesOfDay(data.now);
  const lessons = lessonsOn(data.entries, today, data.weekAnchor);
  const next = groupExams(data.exams, today).upcoming[0];
  return startHeading({
    today,
    lessonsToday: lessons.length,
    lessonsLeft: lessons.filter((lesson) => toMinutes(lesson.endTime) > minutes).length,
    exam: next
      ? { kind: next.kind, subject: data.subjectName(next.subjectId), date: next.date }
      : null,
  });
}
