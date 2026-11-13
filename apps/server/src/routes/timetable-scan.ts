import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { TIME_PATTERN } from '../domain/dates';
import { idField } from '../http/fields';
import { limitBody, readJson } from '../http/json';
import type { AppEnv } from '../http/types';
import { modelIdField } from '../providers/models';
import {
  MAX_ABBREVIATION_CODE,
  MAX_ABBREVIATION_SUBJECT,
  MAX_ABBREVIATIONS,
  type ScanAbbreviations,
} from '../timetable-scan/abbreviations';
import {
  MAX_SCAN_IMAGE_BYTES,
  readScanImage,
  SCAN_BODY_LIMIT,
  type ScanImage,
} from '../timetable-scan/image';
import { MAX_PERIOD_NUMBER, MAX_SCAN_ENTRIES } from '../timetable-scan/parse';
import {
  isValidSchedule,
  type PeriodSchedule,
  type PeriodTimes,
  SCHEDULE_LIMITS,
} from '../timetable-scan/periods';
import type {
  ImportResult,
  ScanImportEntry,
  ScanResult,
  TimetableScanService,
} from '../timetable-scan/service';

// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(NO_CONTROL)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null);

const ScanEntry = z.strictObject({
  weekday: z.number().int().min(1).max(7),
  startTime: z.string().regex(TIME_PATTERN),
  endTime: z.string().regex(TIME_PATTERN),
  code: optionalText(40),
  subject: optionalText(80),
  room: optionalText(40),
  note: optionalText(200),
  week: z.enum(['all', 'a', 'b']),
});

const ImportBody = z.strictObject({
  entries: z.array(ScanEntry).min(1).max(MAX_SCAN_ENTRIES),
  createSubjects: z.boolean().default(true),
  replaceExisting: z.boolean().default(false),
});

const minutes = (limits: { min: number; max: number }) =>
  z.number().int().min(limits.min).max(limits.max);

const ScheduleBody = z.strictObject({
  schedule: z
    .strictObject({
      start: z.string().regex(TIME_PATTERN),
      lessonMinutes: minutes(SCHEDULE_LIMITS.lessonMinutes),
      gapMinutes: minutes(SCHEDULE_LIMITS.gapMinutes),
      count: z.number().int().min(1).max(MAX_PERIOD_NUMBER),
      breaks: z
        .array(
          z.strictObject({
            after: z.number().int().min(1).max(MAX_PERIOD_NUMBER),
            minutes: minutes(SCHEDULE_LIMITS.breakMinutes),
          }),
        )
        .max(MAX_PERIOD_NUMBER),
      mergeDoubles: z.boolean().default(true),
    })
    .refine((schedule) => isValidSchedule(schedule as PeriodSchedule)),
});

const AbbreviationsBody = z.strictObject({
  abbreviations: z
    .array(
      z.strictObject({
        code: z.string().trim().min(1).max(MAX_ABBREVIATION_CODE).regex(NO_CONTROL),
        subject: z.string().trim().min(1).max(MAX_ABBREVIATION_SUBJECT).regex(NO_CONTROL),
      }),
    )
    .max(MAX_ABBREVIATIONS),
});

type Form = Record<string, string | File | Array<string | File>>;

function field(form: Form, name: string): string | null {
  const value = form[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : null;
}

function invalid(c: Context, name: string): Response {
  return c.json({ error: 'invalid_input', field: name }, 400);
}

/**
 * Liest das Formular der Erkennung. Nur ein Bild, nie mehrere; die Datei bleibt im Speicher und
 * wird nirgends abgelegt. Fehlende oder falsche Angaben enden in Codes, nie in einem Text mit Inhalt.
 */
async function readScanForm(
  c: Context,
): Promise<
  | { ok: true; image: ScanImage; providerId: string; model: string }
  | { ok: false; response: Response }
> {
  if (!(c.req.header('content-type') ?? '').startsWith('multipart/form-data')) {
    return { ok: false, response: invalid(c, 'image') };
  }
  let form: Form;
  try {
    form = (await c.req.parseBody({ all: true })) as Form;
  } catch {
    return { ok: false, response: invalid(c, 'image') };
  }
  const raw = form.image;
  const file = Array.isArray(raw) ? raw[0] : raw;
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    return { ok: false, response: invalid(c, 'image') };
  }
  if (file.size > MAX_SCAN_IMAGE_BYTES) {
    return { ok: false, response: c.json({ error: 'payload_too_large' }, 413) };
  }
  const provider = idField.safeParse(field(form, 'providerId'));
  if (!provider.success) return { ok: false, response: invalid(c, 'providerId') };
  const model = modelIdField.safeParse(field(form, 'model'));
  if (!model.success) return { ok: false, response: invalid(c, 'model') };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = readScanImage(file.type, bytes);
  return image
    ? { ok: true, image, providerId: provider.data, model: model.data }
    : { ok: false, response: invalid(c, 'image') };
}

function scanFailure(c: Context, result: Extract<ScanResult, { ok: false }>): Response {
  switch (result.error) {
    case 'images_not_allowed':
      return c.json({ error: 'images_not_allowed' }, 403);
    case 'no_vision_model':
      return c.json({ error: 'no_vision_model' }, 409);
    case 'invalid_response':
      return c.json({ error: 'invalid_response' }, 502);
    case 'provider_failed':
      if (result.code === 'aborted') return c.json({ error: 'aborted' }, 408);
      return c.json({ error: 'provider_failed', code: result.code ?? 'upstream_error' }, 502);
  }
}

function importFailure(c: Context, result: Extract<ImportResult, { ok: false }>): Response {
  switch (result.error) {
    case 'invalid_time':
      return c.json({ error: 'invalid_input', field: 'endTime', reason: 'before_start' }, 400);
    case 'invalid_subject':
      return c.json({ error: 'invalid_input', field: 'subject' }, 400);
    case 'too_many':
      return c.json({ error: 'too_many' }, 409);
    case 'not_found':
      return c.json({ error: 'not_found' }, 404);
    case 'invalid_date':
      return c.json({ error: 'invalid_input', field: 'date' }, 400);
  }
}

/**
 * Stundenplan aus einem Bild (D-107): Modelle auflisten, Bild erkennen lassen und die geprüften
 * Vorschläge übernehmen. Erkennen und Übernehmen sind getrennt: die Vorschau ändert keine Daten.
 */
export function timetableScanRoutes(
  service: TimetableScanService,
  periodTimes: PeriodTimes,
  abbreviations: ScanAbbreviations,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/timetable-scan', limitBody(SCAN_BODY_LIMIT));
  app.use('/timetable-scan/*', limitBody(SCAN_BODY_LIMIT));
  app.use('/timetable-scan/periods', limitBody(4096));
  app.use('/timetable-scan/abbreviations', limitBody(32_768));

  app.get('/timetable-scan/models', async (c) => c.json({ models: await service.models() }));

  /** Die Stundentafel: Regel (Beginn, Länge, Pausen) und die daraus berechneten Uhrzeiten. */
  app.get('/timetable-scan/periods', (c) =>
    c.json({ schedule: periodTimes.schedule(), periods: periodTimes.list() }),
  );

  app.put('/timetable-scan/periods', async (c) => {
    const body = await readJson(c, ScheduleBody);
    if (!body.ok) return body.response;
    periodTimes.replace(body.data.schedule);
    return c.json({ schedule: periodTimes.schedule(), periods: periodTimes.list() });
  });

  /** Eigene Kürzel für Kurscodes („voc = Chor“), gehen dem Katalog vor. */
  app.get('/timetable-scan/abbreviations', (c) => c.json({ abbreviations: abbreviations.list() }));

  app.put('/timetable-scan/abbreviations', async (c) => {
    const body = await readJson(c, AbbreviationsBody);
    if (!body.ok) return body.response;
    return c.json({ abbreviations: abbreviations.replace(body.data.abbreviations) });
  });

  app.post('/timetable-scan', async (c) => {
    const form = await readScanForm(c);
    if (!form.ok) return form.response;
    const result = await service.scan({
      image: form.image,
      providerId: form.providerId,
      model: form.model,
      signal: c.req.raw.signal,
    });
    return result.ok ? c.json(result.value) : scanFailure(c, result);
  });

  app.post('/timetable-scan/import', async (c) => {
    const body = await readJson(c, ImportBody);
    if (!body.ok) return body.response;
    const result = service.importScan({
      entries: body.data.entries as ScanImportEntry[],
      createSubjects: body.data.createSubjects,
      replaceExisting: body.data.replaceExisting,
    });
    return result.ok ? c.json(result.value, 201) : importFailure(c, result);
  });

  return app;
}
