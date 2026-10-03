import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_ROOT } from '../paths';
import {
  findCatalogEntryByName,
  foldName,
  loadSubjectCatalog,
  MAX_TEMPLATES,
} from './subject-templates';

const category = { id: 'beispiele', name: 'Beispiele' };

describe('Fächer-Katalog', () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  function write(content: unknown): string {
    const file = join(base, 'katalog.json');
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
  }

  const v2 = (subjects: unknown[], categories: unknown[] = [category]) => ({
    version: 2,
    categories,
    subjects,
  });
  const entry = (key: string, name: string, extra: Record<string, unknown> = {}) => ({
    key,
    name,
    category: 'beispiele',
    ...extra,
  });

  it('liest Schlüssel, Name, Kategorie, Icon und Suchbegriffe (Version 2)', () => {
    const file = write(
      v2([
        entry('beispielfach-a', 'Beispielfach A', { icon: 'book', aliases: ['Fach A', 'A-Fach'] }),
        entry('beispielfach-b', 'Beispielfach B'),
      ]),
    );
    expect(loadSubjectCatalog(file)).toEqual({
      categories: [category],
      subjects: [
        {
          key: 'beispielfach-a',
          name: 'Beispielfach A',
          category: 'beispiele',
          icon: 'book',
          aliases: ['Fach A', 'A-Fach'],
        },
        {
          key: 'beispielfach-b',
          name: 'Beispielfach B',
          category: 'beispiele',
          icon: null,
          aliases: [],
        },
      ],
    });
  });

  it('liest das alte Format (Version 1, nur Namen) ohne Schlüssel und Kategorie', () => {
    const file = write({
      version: 1,
      subjects: [
        { name: 'Beispielfach A', teacher: 'Beispiel-Lehrkraft' },
        { name: 'Beispielfach B' },
      ],
    });
    expect(loadSubjectCatalog(file)).toEqual({
      categories: [],
      subjects: [
        { key: null, name: 'Beispielfach A', category: null, icon: null, aliases: [] },
        { key: null, name: 'Beispielfach B', category: null, icon: null, aliases: [] },
      ],
    });
  });

  it('entfernt doppelte Namen und Schlüssel unabhängig von Schreibweise und Umlauten', () => {
    const file = write(
      v2([
        entry('fach-a', 'Beispielfach'),
        entry('fach-b', 'BEISPIELFACH'),
        entry('fach-c', 'Übungsfach'),
        entry('fach-d', 'Uebungsfach'),
        entry('fach-a', 'Anderer Name'),
      ]),
    );
    expect(loadSubjectCatalog(file).subjects.map((s) => s.name)).toEqual([
      'Beispielfach',
      'Übungsfach',
    ]);
  });

  it('lässt „Standard“ und die Schlüssel des eingebauten Fachs nicht zu', () => {
    const file = write(
      v2([
        entry('standard', 'Beispielfach A'),
        entry('fach-c', 'Standard'),
        entry('fach-d', 'STANDARD'),
        entry('fach-e', 'Beispielfach E'),
      ]),
    );
    expect(loadSubjectCatalog(file).subjects.map((s) => s.key)).toEqual(['fach-e']);
  });

  it('verwirft Einträge mit unbekannter Kategorie und Suchbegriffe, die dem Namen gleichen', () => {
    const file = write(
      v2([
        entry('fach-a', 'Beispielfach A', { aliases: ['beispielfach a', 'Fach A'] }),
        { key: 'fach-b', name: 'Beispielfach B', category: 'gibt-es-nicht' },
      ]),
    );
    const { subjects } = loadSubjectCatalog(file);
    expect(subjects).toHaveLength(1);
    expect(subjects[0]?.aliases).toEqual(['Fach A']);
  });

  it.each([
    ['eine fehlende Datei', null],
    ['kein JSON', 'das ist kein JSON'],
    ['eine unbekannte Version', { version: 3, subjects: [] }],
    ['einen ungültigen Namen', v2([entry('fach-a', '')])],
    ['einen ungültigen Schlüssel', v2([entry('Fach A', 'Beispielfach')])],
    ['den Rückfall-Schlüssel _generic', v2([entry('_generic', 'Beispielfach')])],
    ['ein ungültiges Icon', v2([entry('fach-a', 'Beispielfach', { icon: 'Großes Icon' })])],
    [
      'zu viele Suchbegriffe',
      v2([entry('fach-a', 'Beispielfach', { aliases: Array(9).fill('x') })]),
    ],
    [
      'zu viele Einträge',
      v2(
        Array.from({ length: MAX_TEMPLATES + 1 }, (_, i) =>
          entry(`fach-${i}`, `Beispielfach ${i}`),
        ),
      ),
    ],
  ])('liefert bei %s einen leeren Katalog', (_label, content) => {
    const file = content === null ? join(base, 'gibt-es-nicht.json') : write(content);
    expect(loadSubjectCatalog(file)).toEqual({ categories: [], subjects: [] });
  });

  it('findet Vorlagen über Name und Suchbegriffe, ohne Groß- und Kleinschreibung und Umlaute', () => {
    const catalog = loadSubjectCatalog(
      write(
        v2([
          entry('franzoesisch', 'Französisch', { aliases: ['Franz'] }),
          entry('geographie', 'Geographie', { aliases: ['Erdkunde'] }),
        ]),
      ),
    );
    expect(findCatalogEntryByName(catalog, 'FRANZÖSISCH')?.key).toBe('franzoesisch');
    expect(findCatalogEntryByName(catalog, 'franzoesisch')?.key).toBe('franzoesisch');
    expect(findCatalogEntryByName(catalog, ' erdkunde ')?.key).toBe('geographie');
    expect(findCatalogEntryByName(catalog, 'Chemie')).toBeUndefined();
  });

  it('faltet Namen für Vergleich und Suche', () => {
    expect(foldName('Französisch')).toBe('franzoesisch');
    expect(foldName('  Straße  ')).toBe('strasse');
    expect(foldName('Café  Müller')).toBe('cafe mueller');
    expect(foldName('Ä')).toBe('ae');
  });
});

describe('mitgelieferter Katalog (config/subject-catalog.json)', () => {
  const file = join(APP_ROOT, 'config', 'subject-catalog.json');
  const catalog = loadSubjectCatalog(file);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { subjects: unknown[] };

  it('ist vollständig lesbar: kein Eintrag wurde aussortiert', () => {
    expect(catalog.subjects.length).toBeGreaterThanOrEqual(60);
    expect(catalog.subjects).toHaveLength(raw.subjects.length);
    expect(catalog.categories.length).toBeGreaterThanOrEqual(5);
  });

  it.each([
    ['Chemie', 'chemie'],
    ['Biologie', 'biologie'],
    ['Latein', 'latein'],
    ['Französisch', 'franzoesisch'],
    ['Griechisch', 'griechisch'],
    ['Mathematik', 'mathematik'],
    ['Deutsch', 'deutsch'],
    ['Englisch', 'englisch'],
  ])('enthält %s (%s)', (name, key) => {
    expect(findCatalogEntryByName(catalog, name)?.key).toBe(key);
  });

  it('findet regionale Fachnamen über Suchbegriffe', () => {
    expect(findCatalogEntryByName(catalog, 'Erdkunde')?.key).toBe('geographie');
    expect(findCatalogEntryByName(catalog, 'Sozialkunde')?.key).toBe('politik');
    expect(findCatalogEntryByName(catalog, 'NwT')?.key).toBe('naturwissenschaften');
  });

  it('enthält nur Fachnamen: keine Personen, Schulen, Orte, Stunden oder Prompts', () => {
    const allowedKeys = new Set(['key', 'name', 'category', 'icon', 'aliases']);
    for (const entry of raw.subjects as Record<string, unknown>[]) {
      expect(Object.keys(entry).every((k) => allowedKeys.has(k))).toBe(true);
    }
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/@|https?:\/\/|www\./i);
    expect(text).not.toMatch(/prompt|stunden|lehrkraft/i);
  });
});
