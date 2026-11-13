import { TIME_PATTERN, type WeekKind } from '../domain/dates';
import { foldName } from '../domain/subject-templates';

/**
 * Antwort des Modells für die Stundenplan-Erkennung (D-107). Der Text ist nicht vertrauenswürdig:
 * hier wird ausschließlich JSON gelesen, mit festen Grenzen geprüft und in bekannte Felder
 * übersetzt. Nie `eval`, nie `new Function`, keine Felder des Modells werden weitergereicht.
 */

/** So viele Stunden darf eine einzige Erkennung höchstens liefern. */
export const MAX_SCAN_ENTRIES = 200;
/** Höchste Nummer einer Unterrichtsstunde, die aus einem Bild akzeptiert wird. */
export const MAX_PERIOD_NUMBER = 16;
const MAX_REPLY_CHARACTERS = 60_000;
const MAX_SUBJECT_CHARACTERS = 80;
const MAX_CODE_CHARACTERS = 40;
const MAX_ROOM_CHARACTERS = 40;
const MAX_NOTE_CHARACTERS = 200;

export interface ScanProposal {
  weekday: number;
  /** Uhrzeit aus dem Bild; `null`, wenn das Bild nur die Nummer der Unterrichtsstunde zeigt. */
  startTime: string | null;
  /** Uhrzeit aus dem Bild; `null`, wenn das Bild nur die Nummer der Unterrichtsstunde zeigt. */
  endTime: string | null;
  /** Nummer der Unterrichtsstunde aus dem Bild, sonst `null`. Ordnet die Stundentafel zu. */
  period: number | null;
  /** Kursbezeichnung so, wie sie im Bild steht (z. B. „2bsp1_2“), sonst `null`. */
  code: string | null;
  /** Erkannter Fachname, `null` wenn im Bild nichts lesbar war. */
  subject: string | null;
  room: string | null;
  note: string | null;
  week: WeekKind;
}

export interface ParsedScan {
  entries: ScanProposal[];
  /** Ungültige oder doppelte Angaben des Modells, die still verworfen wurden. */
  skipped: number;
}

/** Anweisung an das Vision-Modell. Neutrale Vorgabe, keine Namen, keine echten Daten. */
export const SCAN_SYSTEM_PROMPT = [
  'Du liest einen Stundenplan aus einem Bild und antwortest ausschließlich mit einem JSON-Objekt.',
  'Form: {"entries":[{"weekday":1,"startTime":"08:00","endTime":"08:45","period":null,"code":"1bsp1_1","subject":"Beispielfach","room":"Raum 1","note":null,"week":"all"}]}.',
  'Regeln:',
  '- weekday ist eine Zahl: 1 = Montag, 2 = Dienstag, 3 = Mittwoch, 4 = Donnerstag, 5 = Freitag, 6 = Samstag, 7 = Sonntag.',
  '- startTime und endTime sind Uhrzeiten im 24-Stunden-Format "HH:MM". Das Ende liegt nach dem Beginn.',
  '- Steht im Plan nur die Nummer einer Unterrichtsstunde und keine Uhrzeit, setze period auf diese Nummer und startTime und endTime auf null. Gibt es Uhrzeiten, ist period null.',
  '- Zähle die Nummern so, wie sie in der ersten Spalte stehen. Zeilen ohne Einträge (zum Beispiel eine Mittagspause) gehören zu keiner Stunde.',
  '- Jede Unterrichtsstunde ist ein eigener Eintrag, auch bei Doppelstunden (zwei Einträge mit Nummer 1 und 2).',
  '- Leere Zellen sind Freistunden: nicht aufführen.',
  '- code ist die Kursbezeichnung genau so, wie sie in der Zelle steht (zum Beispiel "2ma1_2" oder "1W_BSP_1"), ohne Lehrkraft und Raum. Gibt es keine, null.',
  '- subject ist der ausgeschriebene Fachname, ohne Jahrgang, Kursnummer oder Kursart. Kursbezeichnungen bestehen oft aus einer Ziffer für Jahrgang oder Halbjahr, dem Fachkürzel und einer Kursnummer: "2ma1_2" ist Mathematik, "1e3_1" ist Englisch, "2inf2_2" ist Informatik.',
  '- Übliche Kürzel: d = Deutsch, e = Englisch, f = Französisch, l = Latein, m = Mathematik, ph = Physik, c = Chemie, b = Biologie, inf = Informatik, g = Geschichte, geo = Geographie, ev = Evangelische Religion, k = Katholische Religion, eth = Ethik, mu = Musik, ku = Kunst, sp = Sport.',
  '- Zusätze bleiben Teil des Fachs: "W_" oder "W-" vor dem Fach heißt "W-Seminar <Fach>", "P_" heißt "P-Seminar <Fach>", "vk" vor oder nach dem Fachkürzel heißt "Vertiefungskurs <Fach>". Leistungs- oder Grundkurs (lk, gk) weglassen.',
  '- Ist ein Kürzel nicht sicher zu deuten, schreibe es unverändert in subject. Nichts raten.',
  '- Kurze Buchstabenfolgen neben dem Kurs (oft zwei Buchstaben, zum Beispiel "Ab") sind meist Kürzel von Lehrkräften: nicht in subject, room oder note übernehmen.',
  '- room und note nur übernehmen, wenn sie im Bild stehen; sonst null. Keine Personen, Lehrkräfte oder Schulnamen als Fach.',
  '- week ist "a" oder "b", nur wenn A-/B-Wochen im Bild eindeutig markiert sind; sonst "all".',
  '- Nur Stunden aufführen, die im Bild tatsächlich stehen. Nichts erfinden oder ergänzen.',
  '- Ist kein Stundenplan zu erkennen, antworte mit {"entries":[]}.',
  '- Keine Erklärung, kein Markdown, kein Text außerhalb des JSON-Objekts.',
].join('\n');

/** Höchstens so viele eigene Kürzel reisen im Prompt mit. */
const MAX_PROMPT_ABBREVIATIONS = 100;

/**
 * Anweisung mit den eigenen Kürzeln des Nutzers. Die Kürzel sind schon geprüft (kurz, ohne
 * Steuerzeichen); Anführungszeichen werden trotzdem entfernt, damit sie das Format nicht stören.
 */
export function scanSystemPrompt(
  abbreviations: readonly { code: string; subject: string }[],
): string {
  if (abbreviations.length === 0) return SCAN_SYSTEM_PROMPT;
  const strip = (value: string) => value.replace(/["\\]/g, '').trim();
  const lines = abbreviations
    .slice(0, MAX_PROMPT_ABBREVIATIONS)
    .map((entry) => `- ${strip(entry.code)} = ${strip(entry.subject)}`);
  return [
    SCAN_SYSTEM_PROMPT,
    'Eigene Kürzel des Nutzers (gehen den üblichen Kürzeln vor, auch mit Jahrgang und Kursnummer):',
    ...lines,
  ].join('\n');
}

export const SCAN_USER_PROMPT =
  'Lies alle Stunden aus diesem Bild und gib nur das beschriebene JSON-Objekt zurück.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Kurze Angaben ohne Steuerzeichen; leere oder überlange Werte werden zu `null`. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned === '' || cleaned.length > max) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
  if (/[\u0000-\u001f\u007f]/.test(cleaned)) return null;
  return cleaned;
}

/** „8:05“, „08:05“ und „8.05“ werden zu „08:05“. */
function clock(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(String(value).trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ?? '';
  const result = `${String(hour).padStart(2, '0')}:${minute}`;
  return TIME_PATTERN.test(result) ? result : null;
}

/** Eine ganze Zahl zwischen 1 und {@link MAX_PERIOD_NUMBER}, sonst `null`. */
function periodNumber(value: unknown): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_PERIOD_NUMBER
  ) {
    return null;
  }
  return value;
}

const DAY_ALIASES: Readonly<Record<string, number>> = {
  mo: 1,
  montag: 1,
  mon: 1,
  di: 2,
  dienstag: 2,
  die: 2,
  tue: 2,
  mi: 3,
  mittwoch: 3,
  mit: 3,
  wed: 3,
  do: 4,
  donnerstag: 4,
  don: 4,
  thu: 4,
  fr: 5,
  freitag: 5,
  fre: 5,
  fri: 5,
  sa: 6,
  samstag: 6,
  sam: 6,
  sat: 6,
  so: 7,
  sonntag: 7,
  son: 7,
  sun: 7,
};

function weekday(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7) {
    return value;
  }
  if (typeof value === 'string') {
    const numeric = Number(value.trim());
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 7) return numeric;
    return DAY_ALIASES[foldName(value)] ?? null;
  }
  return null;
}

function week(value: unknown): WeekKind {
  if (typeof value !== 'string') return 'all';
  const folded = foldName(value);
  if (folded === 'a' || folded === 'a woche' || folded === 'woche a') return 'a';
  if (folded === 'b' || folded === 'b woche' || folded === 'woche b') return 'b';
  return 'all';
}

/** Nimmt das JSON-Objekt aus einer Antwort, auch wenn das Modell es in einen Code-Block packt. */
function extractJson(raw: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export function parseScanReply(reply: string): ParsedScan {
  const json = extractJson(reply.slice(0, MAX_REPLY_CHARACTERS));
  if (json === null) return { entries: [], skipped: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { entries: [], skipped: 0 };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.entries)) return { entries: [], skipped: 0 };

  const entries: ScanProposal[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of parsed.entries.slice(0, MAX_SCAN_ENTRIES * 4)) {
    if (entries.length >= MAX_SCAN_ENTRIES) {
      skipped += 1;
      continue;
    }
    if (!isRecord(raw)) {
      skipped += 1;
      continue;
    }
    const day = weekday(raw.weekday);
    const start = clock(raw.startTime);
    const end = clock(raw.endTime);
    const period = periodNumber(raw.period);
    const timed = start !== null && end !== null && end > start;
    // Mit Uhrzeiten zählen nur die Zeiten; ohne sie darf die Stunde ihre Nummer tragen, die die
    // Stundentafel später zu Uhrzeiten ordnet. Halbe Angaben (nur Beginn oder nur Ende) gelten nicht.
    if (day === null || (!timed && !(period !== null && start === null && end === null))) {
      skipped += 1;
      continue;
    }
    const code = text(raw.code, MAX_CODE_CHARACTERS);
    const subject = text(raw.subject, MAX_SUBJECT_CHARACTERS);
    const room = text(raw.room, MAX_ROOM_CHARACTERS);
    const note = text(raw.note, MAX_NOTE_CHARACTERS);
    const kind = week(raw.week);
    const timeKey = timed ? `${start}|${end}` : `nummer-${period}`;
    const key = `${day}|${timeKey}|${kind}|${foldName(subject ?? code ?? '')}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    entries.push({
      weekday: day,
      startTime: timed ? start : null,
      endTime: timed ? end : null,
      period: timed ? null : period,
      code,
      subject,
      room,
      note,
      week: kind,
    });
  }
  skipped += Math.max(0, parsed.entries.length - MAX_SCAN_ENTRIES * 4);
  return { entries, skipped };
}
