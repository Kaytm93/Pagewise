import { z } from 'zod';
import { subjects } from '../db/schema';
import {
  addDays,
  appliesInWeek,
  DATE_PATTERN,
  daysBetween,
  isValidDate,
  localDate,
  weekdayOf,
  weekKindOf,
} from '../domain/dates';
import { listExams } from '../domain/exams';
import { getWeekAnchor, listTimetable } from '../domain/timetable';
import { limitList, type ToolContext, type ToolDefinition } from './registry';

export const WEEKDAY_NAMES = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
] as const;

const MAX_EXAMS_RETURNED = 50;
/** Ohne Angabe schaut `get_exams` ein halbes Jahr voraus. */
const DEFAULT_LOOKAHEAD_DAYS = 183;

const date = z.string().regex(DATE_PATTERN).refine(isValidDate);

function subjectNames(context: ToolContext): Map<string, string> {
  return new Map(
    context.db
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .all()
      .map((row) => [row.id, row.name]),
  );
}

const timetableArgs = z.strictObject({
  weekday: z.number().int().min(1).max(7).optional(),
  week: z.enum(['a', 'b']).optional(),
});

/** Stundenplan lesen: die ganze Woche oder ein Wochentag, in der aktuellen oder einer gewählten Wochenart. */
export const getTimetable: ToolDefinition<z.infer<typeof timetableArgs>> = {
  name: 'get_timetable',
  description:
    'Liest den Stundenplan der Person. Ohne Angaben kommt die ganze Woche der aktuellen Wochenart. Mit "weekday" (1 = Montag bis 7 = Sonntag) nur dieser Tag, mit "week" ("a" oder "b") die Stunden dieser Wochenart.',
  parameters: {
    type: 'object',
    properties: {
      weekday: {
        type: 'integer',
        minimum: 1,
        maximum: 7,
        description: '1 = Montag bis 7 = Sonntag',
      },
      week: { type: 'string', enum: ['a', 'b'], description: 'Wochenart A oder B' },
    },
    additionalProperties: false,
  },
  schema: timetableArgs,
  target: (args) => (args.weekday ? (WEEKDAY_NAMES[args.weekday - 1] ?? null) : null),
  run(args, context) {
    const today = localDate(context.now());
    const anchor = getWeekAnchor(context.db);
    const current = weekKindOf(today, anchor);
    const wanted = args.week ?? current;
    const names = subjectNames(context);
    const entries = listTimetable(context.db).filter(
      (entry) =>
        (args.weekday === undefined || entry.weekday === args.weekday) &&
        appliesInWeek(entry.week, wanted),
    );
    return JSON.parse(
      limitList(
        (items, truncated) => ({
          today,
          weekday: WEEKDAY_NAMES[weekdayOf(today) - 1],
          currentWeek: current,
          shownWeek: wanted,
          lessons: items.map((entry) => ({
            weekday: WEEKDAY_NAMES[entry.weekday - 1],
            from: entry.startTime,
            to: entry.endTime,
            subject: entry.subjectId ? (names.get(entry.subjectId) ?? null) : null,
            room: entry.room,
            note: entry.note,
            week: entry.week,
          })),
          truncated,
        }),
        entries,
      ),
    );
  },
};

const examArgs = z.strictObject({
  from: date.optional(),
  to: date.optional(),
  subject: z.string().trim().min(1).max(80).optional(),
});

/** Tests lesen: ab heute, in einem Zeitraum und/oder für ein Fach. */
export const getExams: ToolDefinition<z.infer<typeof examArgs>> = {
  name: 'get_exams',
  description:
    'Liest die Testeinträge der Person (Schulaufgabe, Test, Ex, Referat …) mit Datum. Ohne Angaben kommen die Einträge von heute an für ein halbes Jahr. Mit "from" und "to" (YYYY-MM-DD) ein Zeitraum, mit "subject" nur ein Fach (Name).',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Erster Tag, YYYY-MM-DD' },
      to: { type: 'string', description: 'Letzter Tag, YYYY-MM-DD' },
      subject: { type: 'string', description: 'Name des Fachs' },
    },
    additionalProperties: false,
  },
  schema: examArgs,
  target: (args) => args.subject ?? null,
  run(args, context) {
    const today = localDate(context.now());
    const from = args.from ?? today;
    const to = args.to ?? addDays(from, DEFAULT_LOOKAHEAD_DAYS);
    const names = subjectNames(context);
    let subjectId: string | undefined;
    if (args.subject) {
      const wanted = args.subject.normalize('NFC').toLocaleLowerCase('de');
      subjectId = [...names].find(
        ([, name]) => name.normalize('NFC').toLocaleLowerCase('de') === wanted,
      )?.[0];
      // Ein unbekanntes Fach ergibt keine Einträge, nicht alle.
      if (!subjectId) {
        return { today, from, to, subjectFound: false, exams: [], truncated: false };
      }
    }
    const found = listExams(context.db, { from, to, subjectId }).slice(0, MAX_EXAMS_RETURNED + 1);
    const more = found.length > MAX_EXAMS_RETURNED;
    return JSON.parse(
      limitList(
        (items, truncated) => ({
          today,
          from,
          to,
          exams: items.map((exam) => ({
            date: exam.date,
            weekday: WEEKDAY_NAMES[weekdayOf(exam.date) - 1],
            inDays: daysBetween(today, exam.date),
            time: exam.time,
            kind: exam.kind,
            title: exam.title,
            subject: names.get(exam.subjectId) ?? null,
            topics: exam.topics,
            notes: exam.notes,
          })),
          truncated: truncated || more,
        }),
        found.slice(0, MAX_EXAMS_RETURNED),
      ),
    );
  },
};
