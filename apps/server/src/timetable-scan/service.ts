import type { Db } from '../db/client';
import { TIME_PATTERN, type WeekKind } from '../domain/dates';
import {
  DEFAULT_SUBJECT_NAME,
  findCatalogEntryByName,
  foldName,
  type SubjectCatalog,
} from '../domain/subject-templates';
import { createSubject, listSubjects } from '../domain/subjects';
import {
  importTimetableEntries,
  listTimetable,
  MAX_TIMETABLE_ENTRIES,
  type PlannerFailure,
  type TimetableInput,
} from '../domain/timetable';
import type { ChatRequest } from '../providers/client';
import { ProviderError, type ProviderErrorCode } from '../providers/errors';
import type { ProviderService } from '../providers/service';
import { imageDataUrl, type ScanImage } from './image';
import {
  MAX_SCAN_ENTRIES,
  parseScanReply,
  SCAN_SYSTEM_PROMPT,
  SCAN_USER_PROMPT,
  type ScanProposal,
} from './parse';
import type { PeriodTimes } from './periods';

export interface ScanModelView {
  providerId: string;
  providerName: string;
  model: string;
  label: string;
  /** Kostenloses Modell: der Anbieter kann Eingaben protokollieren. */
  free: boolean;
}

export interface ScanProposalView extends Omit<ScanProposal, 'startTime' | 'endTime'> {
  /** Konkrete Uhrzeiten: ohne Uhrzeiten im Bild hat die Stundentafel sie zugeordnet. */
  startTime: string;
  endTime: string;
  /** Fach, das es schon gibt; `null` bei neuen oder nicht erkannten Fächern. */
  subjectId: string | null;
  subjectState: 'existing' | 'new' | 'none';
}

/** Eine übernommene Stunde: konkrete Uhrzeiten, keine Nummer mehr. */
export interface ScanImportEntry {
  weekday: number;
  startTime: string;
  endTime: string;
  subject: string | null;
  room: string | null;
  note: string | null;
  week: WeekKind;
}

export interface ScanSuccess {
  proposals: ScanProposalView[];
  /** Fachnamen, die beim Übernehmen neu angelegt würden. */
  newSubjects: string[];
  /** Vom Modell gelieferte, aber unbrauchbare oder doppelte Angaben. */
  skipped: number;
}

export type ScanFailureCode =
  | 'images_not_allowed'
  | 'no_vision_model'
  | 'provider_failed'
  | 'invalid_response';

export type ScanResult =
  | { ok: true; value: ScanSuccess }
  | { ok: false; error: ScanFailureCode; code?: ProviderErrorCode };

export interface ScanImportInput {
  entries: ScanImportEntry[];
  createSubjects: boolean;
  replaceExisting: boolean;
}

export interface ScanImportResult {
  created: number;
  subjectsCreated: number;
}

export type ImportResult =
  | { ok: true; value: ScanImportResult }
  | { ok: false; error: PlannerFailure['error'] };

interface SubjectMatch {
  /** Name, der für ein neues Fach benutzt wird (Katalognamen statt Kürzel). */
  canonical: string;
  id: string | null;
  state: ScanProposalView['subjectState'];
  templateKey: string | null;
  icon: string | null;
}

/** Längster Text, den ein Modell für diese eine Erkennung liefern darf. */
const MAX_REPLY_CHARACTERS = 120_000;

/**
 * Schwere Bildverstehen-Modelle denken lange, bevor sie antworten, und der Scan liest die Antwort
 * als Ganzes (`stream: false`): bis dahin kommt kein einziges Zeichen. Der Leerlauf-Wächter des
 * Clients (2 Minuten) würde solche Anfragen regelmäßig abwürgen; die Erkennung trägt deshalb eine
 * eigene, größere Geduld (5 Minuten).
 */
const SCAN_IDLE_TIMEOUT_MS = 300_000;

/**
 * Erkennt Stundenpläne aus einem Bild (D-107). Nur Modelle, die laut Konfiguration Bilder verstehen
 * **und** deren Anbieter Bilder senden darf, werden benutzt. Das Bild bleibt im Speicher, wird nicht
 * gespeichert und nicht protokolliert; Antworttexte des Modells verlassen diese Datei nicht.
 */
export class TimetableScanService {
  constructor(
    private readonly db: Db,
    private readonly providers: ProviderService,
    private readonly catalog: SubjectCatalog,
    private readonly periodTimes: PeriodTimes,
  ) {}

  /** Modelle, die für die Bilderkennung zur Wahl stehen. */
  async models(): Promise<ScanModelView[]> {
    const providers = await this.providers.list();
    const options: ScanModelView[] = [];
    for (const provider of providers) {
      if (!provider.sendImages) continue;
      for (const model of provider.models) {
        if (!model.vision) continue;
        options.push({
          providerId: provider.id,
          providerName: provider.name,
          model: model.id,
          label: `${provider.name} · ${model.id}`,
          free: model.free,
        });
      }
    }
    return options;
  }

  private matchSubject(name: string): SubjectMatch {
    const template = findCatalogEntryByName(this.catalog, name);
    const canonical = template?.name ?? name;
    const subjects = listSubjects(this.db);
    const found =
      subjects.find((subject) => foldName(subject.name) === foldName(canonical)) ??
      subjects.find((subject) => foldName(subject.name) === foldName(name));
    if (found) {
      return {
        canonical: found.name,
        id: found.id,
        state: 'existing',
        templateKey: null,
        icon: null,
      };
    }
    // Das eingebaute Fach „Standard“ darf nie als Stundenplan-Fach angelegt werden.
    if (foldName(canonical) === foldName(DEFAULT_SUBJECT_NAME)) {
      return { canonical, id: null, state: 'none', templateKey: null, icon: null };
    }
    return {
      canonical,
      id: null,
      state: 'new',
      templateKey: template?.key ?? null,
      icon: template?.icon ?? null,
    };
  }

  private proposals(
    entries: readonly (ScanProposal & { startTime: string; endTime: string })[],
  ): ScanSuccess {
    const cache = new Map<string, SubjectMatch>();
    const forName = (name: string): SubjectMatch => {
      const key = foldName(name);
      let match = cache.get(key);
      if (!match) {
        match = this.matchSubject(name);
        cache.set(key, match);
      }
      return match;
    };
    const proposals: ScanProposalView[] = entries.map((entry) => {
      const match = entry.subject === null ? null : forName(entry.subject);
      return {
        ...entry,
        subject: match?.canonical ?? entry.subject,
        subjectId: match?.id ?? null,
        subjectState: match?.state ?? 'none',
      };
    });
    const newSubjects = [
      ...new Set(
        proposals
          .filter((entry) => entry.subjectState === 'new' && entry.subject !== null)
          .map((entry) => entry.subject as string),
      ),
    ];
    return { proposals, newSubjects, skipped: 0 };
  }

  async scan(input: {
    image: ScanImage;
    providerId: string;
    model: string;
    signal?: AbortSignal;
  }): Promise<ScanResult> {
    if (!this.providers.allowsImages(input.providerId)) {
      return { ok: false, error: 'images_not_allowed' };
    }
    const resolved = await this.providers.resolve({
      providerId: input.providerId,
      model: input.model,
    });
    if (!resolved?.model.vision) return { ok: false, error: 'no_vision_model' };

    let reply = '';
    try {
      const request: ChatRequest = {
        model: input.model,
        temperature: 0,
        // Eine vollständige Antwort: Vision-Modelle müssen dafür nicht streamen können.
        stream: false,
        messages: [
          { role: 'system', content: SCAN_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: SCAN_USER_PROMPT },
              { type: 'image_url', image_url: { url: imageDataUrl(input.image) } },
            ],
            contentText: SCAN_USER_PROMPT,
          },
        ],
      };
      for await (const event of this.providers.client.streamChat(
        resolved.target,
        request,
        input.signal,
        { idleTimeoutMs: SCAN_IDLE_TIMEOUT_MS },
      )) {
        if (event.type !== 'delta') continue;
        reply += event.text;
        if (reply.length > MAX_REPLY_CHARACTERS) return { ok: false, error: 'invalid_response' };
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        return { ok: false, error: 'provider_failed', code: error.code };
      }
      throw error;
    }

    const parsed = parseScanReply(reply);
    // Zeigt das Bild nur Nummern von Unterrichtsstunden, ordnet die Stundentafel die Uhrzeiten zu;
    // Nummern, die die Tafel nicht kennt, werden verworfen und gezählt.
    const table = new Map(this.periodTimes.list().map((row) => [row.period, row]));
    const mapped: (ScanProposal & { startTime: string; endTime: string })[] = [];
    let unmapped = 0;
    for (const entry of parsed.entries) {
      if (entry.startTime !== null && entry.endTime !== null) {
        mapped.push({
          ...entry,
          startTime: entry.startTime,
          endTime: entry.endTime,
          period: null,
        });
        continue;
      }
      const row = entry.period === null ? undefined : table.get(entry.period);
      if (row) {
        mapped.push({ ...entry, startTime: row.startTime, endTime: row.endTime });
      } else {
        unmapped += 1;
      }
    }
    const result = this.proposals(mapped.slice(0, MAX_SCAN_ENTRIES));
    result.skipped = parsed.skipped + unmapped;
    return { ok: true, value: result };
  }

  /**
   * Übernimmt die geprüften Vorschläge. Fächer werden erst beim Übernehmen angelegt, nie schon beim
   * Erkennen: die Vorschau verändert nichts. Fachnamen werden erneut gegen die Datenbank geprüft,
   * damit die Oberfläche keine Fach-Kennungen einschleusen kann.
   */
  importScan(input: ScanImportInput): ImportResult {
    for (const entry of input.entries) {
      if (
        !TIME_PATTERN.test(entry.startTime) ||
        !TIME_PATTERN.test(entry.endTime) ||
        entry.endTime <= entry.startTime
      ) {
        return { ok: false, error: 'invalid_time' };
      }
    }
    const current = listTimetable(this.db).length;
    const projected = input.replaceExisting ? input.entries.length : current + input.entries.length;
    if (projected > MAX_TIMETABLE_ENTRIES) return { ok: false, error: 'too_many' };

    const cache = new Map<string, string | null>();
    let subjectsCreated = 0;
    const idFor = (name: string): string | null => {
      const key = foldName(name);
      if (cache.has(key)) return cache.get(key) ?? null;
      const match = this.matchSubject(name);
      let id = match.id;
      if (id === null && input.createSubjects && match.state === 'new') {
        const created = createSubject(this.db, match.canonical, {
          templateKey: match.templateKey,
          icon: match.icon,
        });
        if (created.ok) {
          id = created.value.id;
          subjectsCreated += 1;
        }
      }
      cache.set(key, id);
      return id;
    };

    const timetable: TimetableInput[] = input.entries.map((entry) => ({
      weekday: entry.weekday,
      startTime: entry.startTime,
      endTime: entry.endTime,
      subjectId: entry.subject === null ? null : idFor(entry.subject),
      room: entry.room,
      note: entry.note,
      week: entry.week,
    }));
    const result = importTimetableEntries(this.db, timetable, { replace: input.replaceExisting });
    if (!result.ok) return result;
    return { ok: true, value: { created: result.value, subjectsCreated } };
  }
}
