import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { iconField, nameField } from '../http/fields';

/** Name des eingebauten Fachs für den fachunabhängigen Chat. Ein anderes Fach darf ihn nicht tragen. */
export const DEFAULT_SUBJECT_NAME = 'Standard';

/** So viele Vorlagen liest Pagewise höchstens (der mitgelieferte Katalog hat gut 60). */
export const MAX_TEMPLATES = 200;
const MAX_CATEGORIES = 20;
const MAX_ALIASES = 8;

/** Schlüssel von Vorlagen und Kategorien: klein, ASCII, mit Bindestrich. Verknüpft auch die Standard-Prompts. */
export const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Schlüssel, die Pagewise selbst belegt (eingebautes Fach und Rückfall-Text der Standard-Prompts). */
const RESERVED_KEYS = new Set(['standard', '_generic']);

export interface CatalogCategory {
  id: string;
  name: string;
}

export interface CatalogEntry {
  /** `null` bei Dateien im alten Format (Version 1): solche Vorlagen haben keinen Standard-Prompt. */
  key: string | null;
  name: string;
  category: string | null;
  icon: string | null;
  /** Suchbegriffe (z. B. „Erdkunde“ für Geographie). */
  aliases: string[];
}

export interface SubjectCatalog {
  categories: CatalogCategory[];
  subjects: CatalogEntry[];
}

const EMPTY: SubjectCatalog = { categories: [], subjects: [] };

const keyField = z.string().regex(KEY_PATTERN);

const fileV1 = z.object({
  version: z.literal(1),
  subjects: z.array(z.object({ name: nameField })).max(MAX_TEMPLATES),
});

const fileV2 = z.object({
  version: z.literal(2),
  categories: z.array(z.object({ id: keyField, name: nameField })).max(MAX_CATEGORIES),
  subjects: z
    .array(
      z.object({
        key: keyField,
        name: nameField,
        category: keyField,
        icon: iconField.optional(),
        aliases: z.array(nameField).max(MAX_ALIASES).optional(),
      }),
    )
    .max(MAX_TEMPLATES),
});

/**
 * Vergleichsform für Namen und Suche: klein geschrieben, Umlaute und ß als ae, oe, ue, ss, übrige
 * Akzente entfernt. So findet „franzoesisch“ den Eintrag „Französisch“ und umgekehrt.
 */
export function foldName(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('de')
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Neutrale Fächer-Vorlagen für das Onboarding und den Dialog „Fach anlegen“ aus einer Datei,
 * standardmäßig `config/subject-catalog.json`. Format Version 2 (Schlüssel, Kategorie, Icon, Suchbegriffe)
 * oder das alte Format Version 1 (nur Namen). Die Datei enthält nur Fachnamen, nie Personen, Stunden
 * oder Prompts. Ist die Datei weg oder kaputt, gibt es keine Vorlagen. Nichts davon wird angelegt, bevor
 * der Nutzer es auswählt. Doppelte Namen und Schlüssel, reservierte Schlüssel und unbekannte Kategorien
 * werden aussortiert.
 */
export function loadSubjectCatalog(file: string): SubjectCatalog {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return EMPTY;
  }

  const seenNames = new Set<string>();
  const seenKeys = new Set<string>();
  const fresh = (name: string, key: string | null): boolean => {
    const folded = foldName(name);
    if (seenNames.has(folded) || (key !== null && seenKeys.has(key))) return false;
    seenNames.add(folded);
    if (key !== null) seenKeys.add(key);
    return true;
  };

  const v2 = fileV2.safeParse(json);
  if (v2.success) {
    const categories: CatalogCategory[] = [];
    for (const category of v2.data.categories) {
      if (!categories.some((entry) => entry.id === category.id)) categories.push(category);
    }
    const known = new Set(categories.map((category) => category.id));
    const subjects: CatalogEntry[] = [];
    for (const entry of v2.data.subjects) {
      if (RESERVED_KEYS.has(entry.key) || !known.has(entry.category)) continue;
      if (foldName(entry.name) === foldName(DEFAULT_SUBJECT_NAME)) continue;
      if (!fresh(entry.name, entry.key)) continue;
      subjects.push({
        key: entry.key,
        name: entry.name,
        category: entry.category,
        icon: entry.icon ?? null,
        aliases: (entry.aliases ?? []).filter((alias) => foldName(alias) !== foldName(entry.name)),
      });
    }
    return { categories, subjects };
  }

  const v1 = fileV1.safeParse(json);
  if (v1.success) {
    const subjects: CatalogEntry[] = [];
    for (const { name } of v1.data.subjects) {
      if (foldName(name) === foldName(DEFAULT_SUBJECT_NAME)) continue;
      if (fresh(name, null)) {
        subjects.push({ key: null, name, category: null, icon: null, aliases: [] });
      }
    }
    return { categories: [], subjects };
  }
  return EMPTY;
}

/** Sucht die Vorlage zu einem Namen (auch über Suchbegriffe), ohne Groß- und Kleinschreibung und Umlaut-Unterschiede. */
export function findCatalogEntryByName(
  catalog: SubjectCatalog,
  name: string,
): CatalogEntry | undefined {
  const folded = foldName(name);
  return (
    catalog.subjects.find((entry) => foldName(entry.name) === folded) ??
    catalog.subjects.find((entry) => entry.aliases.some((alias) => foldName(alias) === folded))
  );
}
