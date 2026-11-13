import {
  type CatalogEntry,
  findCatalogEntryByAbbreviation,
  findCatalogEntryByName,
  foldName,
  type SubjectCatalog,
} from '../domain/subject-templates';

/** Ein eigenes Kürzel des Nutzers: Kurscode oder Kürzel und der Fachname dazu. */
export interface CourseAbbreviation {
  code: string;
  subject: string;
}

/** Ergebnis der Zuordnung: Fachname und, wenn es eine gibt, die Vorlage aus dem Katalog. */
export interface ResolvedCourse {
  name: string;
  template: CatalogEntry | null;
}

/** Kurscodes sind kurz und haben keine Leerzeichen; alles andere gilt als ausgeschriebener Name. */
const MAX_CODE_CHARACTERS = 24;

/**
 * Kern eines Kurscodes: Jahrgang oder Halbjahr vorn und Kurs- oder Gruppennummern hinten fallen
 * weg, Groß- und Kleinschreibung zählt nicht. Aus „2inf2_2“ wird „inf“, aus „2W_INF_1“ „w_inf“.
 */
export function courseCore(raw: string): string {
  return foldName(raw)
    .replace(/\s+/g, '')
    .replace(/^\d+/, '')
    .replace(/([_\-.]?\d+)+$/, '')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');
}

/** Zusätze vor dem Fach, die einen eigenen Kurs bezeichnen: „W-Seminar Informatik“. */
const PREFIX_MODIFIERS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /^w(?:-?sem(?:inar)?)?[_\-.](.+)$|^wsem(?:inar)?(.+)$/, label: 'W-Seminar' },
  { pattern: /^p(?:-?sem(?:inar)?)?[_\-.](.+)$|^psem(?:inar)?(.+)$/, label: 'P-Seminar' },
  { pattern: /^vk[_\-.]?(.+)$|^(.+?)[_\-.]?vk$/, label: 'Vertiefungskurs' },
];

/** Kursarten, die am Fach nichts ändern („M-LK“ ist Mathematik). */
const IGNORED_LEVELS = /^(?:lk|gk)[_\-.](.+)$|^(.+?)[_\-.]?(?:lk|gk)$/;

/** Ausgeschriebene Zusätze in Fachnamen, damit z. B. „W-Seminar Informatik“ die Vorlage Informatik findet. */
const NAMED_MODIFIERS = /^(?:w-seminar|p-seminar|vertiefungskurs)\s+(.+)$/;

function fromTemplate(template: CatalogEntry | undefined): ResolvedCourse | null {
  return template ? { name: template.name, template } : null;
}

/**
 * Ordnet Kurscodes und Kürzel aus Stundenplänen einem Fach zu. Reihenfolge: eigene Kürzel des
 * Nutzers, Fachkürzel und Namen des Katalogs, dann Zusätze wie W-Seminar oder Vertiefungskurs. Die
 * Kursnummer ist egal: „2inf2_2“ und „1inf1_1“ sind beide Informatik. Ohne Treffer `null`: dann
 * bleibt der Vorschlag des Modells stehen.
 */
export class CourseResolver {
  private readonly own: Map<string, string>;

  constructor(
    private readonly catalog: SubjectCatalog,
    abbreviations: readonly CourseAbbreviation[] = [],
  ) {
    this.own = new Map();
    for (const entry of abbreviations) {
      const key = courseCore(entry.code) || foldName(entry.code);
      if (key !== '' && !this.own.has(key)) this.own.set(key, entry.subject);
    }
  }

  resolve(raw: string | null): ResolvedCourse | null {
    if (raw === null) return null;
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const own = this.own.get(foldName(trimmed)) ?? this.own.get(courseCore(trimmed));
    if (own !== undefined) return { name: own, template: this.templateFor(own) };
    if (/\s/.test(trimmed) || trimmed.length > MAX_CODE_CHARACTERS) {
      return fromTemplate(findCatalogEntryByName(this.catalog, trimmed));
    }
    const core = courseCore(trimmed);
    if (core === '') return null;
    const plain = this.plain(core);
    if (plain) return plain;

    const level = IGNORED_LEVELS.exec(core);
    const levelCore = level?.[1] ?? level?.[2];
    if (levelCore) {
      const base = this.plain(levelCore);
      if (base) return base;
    }
    for (const modifier of PREFIX_MODIFIERS) {
      const match = modifier.pattern.exec(core);
      const rest = match?.[1] ?? match?.[2];
      if (!rest) continue;
      const base = this.plain(rest);
      if (base) return { name: `${modifier.label} ${base.name}`, template: base.template };
    }
    return null;
  }

  /** Vorlage für einen fertigen Fachnamen, auch mit Zusatz („Vertiefungskurs Mathematik“). */
  templateFor(name: string): CatalogEntry | null {
    const direct = findCatalogEntryByName(this.catalog, name);
    if (direct) return direct;
    const match = NAMED_MODIFIERS.exec(foldName(name));
    return (match?.[1] && findCatalogEntryByName(this.catalog, match[1])) || null;
  }

  /** Kern ohne Zusätze: eigenes Kürzel, Fachkürzel, Name oder Suchbegriff des Katalogs. */
  private plain(core: string): ResolvedCourse | null {
    const cleaned = core.replace(/[_\-.]+/g, '');
    const own = this.own.get(core) ?? this.own.get(cleaned);
    if (own !== undefined) return { name: own, template: this.templateFor(own) };
    return (
      fromTemplate(findCatalogEntryByAbbreviation(this.catalog, cleaned)) ??
      fromTemplate(findCatalogEntryByName(this.catalog, cleaned))
    );
  }
}
