import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client';
import { DATE_PATTERN, isValidDate, TIME_PATTERN } from '../domain/dates';
import {
  createExam,
  deleteExam,
  type ExamInput,
  type ExamView,
  listExams,
  updateExam,
} from '../domain/exams';
import {
  createTimetableEntry,
  deleteTimetableEntry,
  getWeekAnchor,
  listTimetable,
  type PlannerFailure,
  setWeekAnchor,
  type TimetableInput,
  updateTimetableEntry,
} from '../domain/timetable';
import { idField } from '../http/fields';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';

// Kurze Angaben ohne Steuerzeichen; leer bedeutet „nicht angegeben“ (null).
// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const shortText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(NO_CONTROL)
    .transform((value) => (value === '' ? null : value))
    .nullable();
// Längere Texte (Themen, Notizen): Zeilenumbrüche erlaubt.
const longText = (max: number) =>
  z
    .string()
    .max(max)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
    .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    .transform((value) => {
      const unified = value.replace(/\r\n?/g, '\n').trim();
      return unified === '' ? null : unified;
    })
    .nullable();

const time = z.string().regex(TIME_PATTERN);
const date = z.string().regex(DATE_PATTERN).refine(isValidDate);

const TimetableBody = z.strictObject({
  weekday: z.number().int().min(1).max(7),
  startTime: time,
  endTime: time,
  subjectId: idField.nullable().default(null),
  room: shortText(40).default(null),
  note: shortText(200).default(null),
  week: z.enum(['all', 'a', 'b']).default('all'),
});
const TimetablePatch = z
  .strictObject({
    weekday: z.number().int().min(1).max(7).optional(),
    startTime: time.optional(),
    endTime: time.optional(),
    subjectId: idField.nullable().optional(),
    room: shortText(40).optional(),
    note: shortText(200).optional(),
    week: z.enum(['all', 'a', 'b']).optional(),
  })
  .refine((body) => Object.keys(body).length > 0);
const WeekBody = z.strictObject({
  anchor: z.strictObject({ date, week: z.enum(['a', 'b']) }).nullable(),
});

const ExamBody = z.strictObject({
  subjectId: idField,
  kind: z.string().trim().min(1).max(40).regex(NO_CONTROL),
  title: shortText(120).default(null),
  date,
  time: time.nullable().default(null),
  topics: longText(2000).default(null),
  notes: longText(2000).default(null),
});
const ExamPatch = z
  .strictObject({
    subjectId: idField.optional(),
    kind: z.string().trim().min(1).max(40).regex(NO_CONTROL).optional(),
    title: shortText(120).optional(),
    date: date.optional(),
    time: time.nullable().optional(),
    topics: longText(2000).optional(),
    notes: longText(2000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0);
const ExamQuery = z.strictObject({
  from: date.optional(),
  to: date.optional(),
  subjectId: idField.optional(),
});

function failure(c: Context, result: PlannerFailure): Response {
  switch (result.error) {
    case 'not_found':
      return c.json({ error: 'not_found' }, 404);
    case 'invalid_subject':
      return c.json({ error: 'invalid_input', field: 'subjectId' }, 400);
    case 'invalid_time':
      return c.json({ error: 'invalid_input', field: 'endTime', reason: 'before_start' }, 400);
    case 'invalid_date':
      return c.json({ error: 'invalid_input', field: 'date' }, 400);
    case 'too_many':
      return c.json({ error: 'too_many' }, 409);
  }
}

function idParam(c: Context): string | null {
  const parsed = idField.safeParse(c.req.param('id'));
  return parsed.success ? parsed.data : null;
}

/**
 * Stundenplan (`/api/timetable`) und Testeinträge (`/api/exams`). Alles bleibt lokal. Die KI sieht diese Daten
 * nur über die Werkzeuge in `tools/` und nur, wenn die Person es erlaubt hat.
 */
export function plannerRoutes(db: Db): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/timetable', limitBody(8 * 1024));
  app.use('/timetable/*', limitBody(8 * 1024));
  app.use('/exams', limitBody(16 * 1024));
  app.use('/exams/*', limitBody(16 * 1024));

  // --- Stundenplan ---------------------------------------------------------------------------------

  app.get('/timetable', (c) =>
    c.json({ entries: listTimetable(db), weekAnchor: getWeekAnchor(db) }),
  );

  app.post('/timetable', async (c) => {
    const body = await readJson(c, TimetableBody);
    if (!body.ok) return body.response;
    const result = createTimetableEntry(db, body.data as TimetableInput);
    return result.ok ? c.json(result.value, 201) : failure(c, result);
  });

  // Welche Wochenart die aktuelle Woche hat („diese Woche ist A“), oder aufheben.
  app.put('/timetable/week', async (c) => {
    const body = await readJson(c, WeekBody);
    if (!body.ok) return body.response;
    const result = setWeekAnchor(db, body.data.anchor);
    return result.ok ? c.json({ weekAnchor: result.value }) : failure(c, result);
  });

  app.patch('/timetable/:id', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, TimetablePatch);
    if (!body.ok) return body.response;
    const result = updateTimetableEntry(db, id, body.data as Partial<TimetableInput>);
    return result.ok ? c.json(result.value) : failure(c, result);
  });

  app.delete('/timetable/:id', (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const result = deleteTimetableEntry(db, id);
    return result.ok ? c.body(null, 204) : failure(c, result);
  });

  // --- Tests ---------------------------------------------------------------------------------------

  app.get('/exams', (c) => {
    const parsed = ExamQuery.safeParse(c.req.query());
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      return c.json(
        { error: 'invalid_input', field: typeof field === 'string' ? field : null },
        400,
      );
    }
    return c.json({ exams: listExams(db, parsed.data) satisfies ExamView[] });
  });

  app.post('/exams', async (c) => {
    const body = await readJson(c, ExamBody);
    if (!body.ok) return body.response;
    const result = createExam(db, body.data as ExamInput);
    return result.ok ? c.json(result.value, 201) : failure(c, result);
  });

  app.patch('/exams/:id', async (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = await readJson(c, ExamPatch);
    if (!body.ok) return body.response;
    const result = updateExam(db, id, body.data as Partial<ExamInput>);
    return result.ok ? c.json(result.value) : failure(c, result);
  });

  app.delete('/exams/:id', (c) => {
    const id = idParam(c);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const result = deleteExam(db, id);
    return result.ok ? c.body(null, 204) : failure(c, result);
  });

  return app;
}
