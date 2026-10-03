import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSubjectCatalog } from '../domain/subject-templates';
import { APP_ROOT } from '../paths';
import { DEFAULT_PROMPT_MAX_CHARACTERS, DefaultPrompts } from './defaults';

const subject = (name: string, templateKey: string | null = null) => ({
  name,
  templateKey,
  kind: 'subject' as const,
});

describe('DefaultPrompts (Lader und Zuordnung)', () => {
  let base: string;
  let dir: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-test-'));
    dir = join(base, 'defaults');
    mkdirSync(dir);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const catalog = (entries: { key: string; name: string; aliases?: string[] }[]) => {
    const file = join(base, 'katalog.json');
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        categories: [{ id: 'beispiele', name: 'Beispiele' }],
        subjects: entries.map((entry) => ({ ...entry, category: 'beispiele' })),
      }),
    );
    return loadSubjectCatalog(file);
  };

  it('liest Dateien, vereinheitlicht Zeilenenden und entfernt Leerraum am Rand', () => {
    writeFileSync(join(dir, 'beispiel-a.md'), '\n  Zeile 1  \r\nZeile 2\t \r\n\n');
    const defaults = DefaultPrompts.load(dir, catalog([]));
    expect(defaults.get('beispiel-a')).toBe('Zeile 1\nZeile 2');
    expect(defaults.keys()).toEqual(['beispiel-a']);
  });

  it('ignoriert ungeeignete Dateien statt abzustürzen', () => {
    writeFileSync(join(dir, 'gut.md'), 'Text');
    writeFileSync(join(dir, 'README.md'), 'Großbuchstaben sind kein Schlüssel');
    writeFileSync(join(dir, 'mit leerzeichen.md'), 'Text');
    writeFileSync(join(dir, '-anfang.md'), 'Text');
    writeFileSync(join(dir, 'nur-text.txt'), 'Text');
    writeFileSync(join(dir, 'leer.md'), '  \n ');
    writeFileSync(join(dir, 'zu-lang.md'), 'x'.repeat(DEFAULT_PROMPT_MAX_CHARACTERS + 1));
    writeFileSync(join(dir, 'riesig.md'), 'x'.repeat(40 * 1024));
    writeFileSync(join(dir, 'steuerzeichen.md'), 'Text\u0000mit NUL');
    mkdirSync(join(dir, 'ordner.md'));
    expect(DefaultPrompts.load(dir, catalog([])).keys()).toEqual(['gut']);
  });

  it('akzeptiert genau die Höchstlänge', () => {
    writeFileSync(join(dir, 'lang.md'), 'x'.repeat(DEFAULT_PROMPT_MAX_CHARACTERS));
    expect(DefaultPrompts.load(dir, catalog([])).keys()).toEqual(['lang']);
  });

  it('läuft ohne Ordner ohne Standardtexte weiter', () => {
    const defaults = DefaultPrompts.load(join(base, 'gibt-es-nicht'), catalog([]));
    expect(defaults.keys()).toEqual([]);
    expect(defaults.resolve(subject('Beispielfach'))).toBeNull();
  });

  describe('resolve', () => {
    beforeEach(() => {
      writeFileSync(join(dir, 'beispiel-a.md'), 'Text A');
      writeFileSync(join(dir, 'beispiel-b.md'), 'Text B');
      writeFileSync(join(dir, '_generic.md'), 'Allgemein');
      writeFileSync(join(dir, 'standard.md'), 'Fachlos');
    });
    const make = () =>
      DefaultPrompts.load(
        dir,
        catalog([
          { key: 'beispiel-a', name: 'Beispielfach A', aliases: ['Fach A'] },
          { key: 'beispiel-b', name: 'Beispielfach B' },
          { key: 'beispiel-c', name: 'Beispielfach C' },
        ]),
      );

    it('bevorzugt den Schlüssel der Vorlage vor dem Namen', () => {
      expect(make().resolve(subject('Beispielfach A', 'beispiel-b'))).toEqual({
        key: 'beispiel-b',
        text: 'Text B',
      });
    });

    it('nutzt sonst die Vorlage zum Namen, auch über Suchbegriffe', () => {
      expect(make().resolve(subject('beispielfach a'))?.key).toBe('beispiel-a');
      expect(make().resolve(subject('Fach A'))?.key).toBe('beispiel-a');
    });

    it('fällt auf _generic zurück: unbekannter Name, unbekannter Schlüssel, Vorlage ohne Datei', () => {
      for (const candidate of [
        subject('Ganz Eigenes Fach'),
        subject('Anderes Fach', 'gibt-es-nicht'),
        subject('Anderes Fach C', 'beispiel-c'),
      ]) {
        expect(make().resolve(candidate)).toEqual({ key: '_generic', text: 'Allgemein' });
      }
    });

    it('gibt dem eingebauten Fach den Text „standard“, auch wenn es anders heißen würde', () => {
      expect(
        make().resolve({ name: 'Beispielfach A', templateKey: 'beispiel-a', kind: 'default' }),
      ).toEqual({ key: 'standard', text: 'Fachlos' });
    });

    it('gibt null zurück, wenn gar nichts passt', () => {
      rmSync(join(dir, '_generic.md'));
      rmSync(join(dir, 'standard.md'));
      const defaults = make();
      expect(defaults.resolve(subject('Ganz Eigenes Fach'))).toBeNull();
      expect(
        defaults.resolve({ name: 'Standard', templateKey: 'standard', kind: 'default' }),
      ).toBeNull();
    });

    it('nutzt für das eingebaute Fach _generic, wenn standard.md fehlt', () => {
      rmSync(join(dir, 'standard.md'));
      expect(
        make().resolve({ name: 'Standard', templateKey: 'standard', kind: 'default' })?.key,
      ).toBe('_generic');
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Die mitgelieferten Texte (prompts/defaults). Sie gelten für alle Nutzer gleich und liegen im
// öffentlichen Repo: Dieser Test ist die Datenschutz-Schranke (D-034). Er ersetzt keine Durchsicht
// durch Menschen, fängt aber Muster, die nie in einen Standardtext gehören.
// ---------------------------------------------------------------------------------------------

describe('mitgelieferte Standard-Prompts (prompts/defaults)', () => {
  const dir = join(APP_ROOT, 'prompts', 'defaults');
  const catalog = loadSubjectCatalog(join(APP_ROOT, 'config', 'subject-catalog.json'));
  const files = readdirSync(dir).filter((name) => name.endsWith('.md'));
  const read = (file: string) => readFileSync(join(dir, file), 'utf8');

  const BUNDESLAENDER = [
    'Baden-Württemberg',
    'Bayern',
    'Berlin',
    'Brandenburg',
    'Bremen',
    'Hamburg',
    'Hessen',
    'Mecklenburg-Vorpommern',
    'Niedersachsen',
    'Nordrhein-Westfalen',
    'Rheinland-Pfalz',
    'Saarland',
    'Sachsen',
    'Sachsen-Anhalt',
    'Schleswig-Holstein',
    'Thüringen',
  ];
  const FORBIDDEN: [string, RegExp][] = [
    ['E-Mail-Adresse', /[^\s@]+@[^\s@]+/],
    ['Adresse im Netz', /https?:\/\/|www\./i],
    ['Telefonnummer', /\+?\d[\d /-]{7,}\d/],
    ['Jahreszahl', /\b(19|20)\d{2}\b/],
    ['Klassenangabe', /\bKlasse\s*\d|\b\d+\.\s*Klasse\b|\bJahrgangsstufe\s*\d/i],
    ['Bundesland', new RegExp(`\\b(${BUNDESLAENDER.join('|')})\\b`)],
    [
      'Lehrplan, Prüfung oder Behörde',
      /Lehrplan|Bildungsplan|Kerncurriculum|Curriculum|Abitur|\bKMK\b|Kultusminister|Bildungsstandard|Abschlussprüfung/i,
    ],
    [
      'Schulform',
      /Gymnasium|Realschule|Mittelschule|Gesamtschule|Grundschule|Hauptschule|Oberschule|Gemeinschaftsschule|Berufsschule/i,
    ],
    ['Produkt- oder Modellname', /Claude|ChatGPT|OpenAI|Anthropic|Pagewise|Gemini|GLM|Copilot/i],
    ['Überschrift', /^\s*#/m],
    ['Emoji', /\p{Extended_Pictographic}/u],
    [
      'Hefteintrag- oder Werkzeug-Syntax',
      /```|\$\$|KaTeX|Hefteintrag|get_timetable|get_exams|Werkzeug/i,
    ],
  ];

  it('gibt es für jedes Katalogfach, dazu `_generic` und `standard`, und nichts darüber hinaus', () => {
    const expected = new Set(['_generic', 'standard', ...catalog.subjects.map((s) => s.key ?? '')]);
    expect(new Set(files.map((file) => file.slice(0, -3)))).toEqual(expected);
  });

  it.each(files)('%s: neutral, kurz und nach Vorgabe aufgebaut', (file) => {
    const text = read(file);
    const key = file.slice(0, -3);

    // Länge: Richtwert 600 bis 1.500 Zeichen, hier die harte Grenze für mitgelieferte Texte.
    expect(text.length).toBeGreaterThanOrEqual(500);
    expect(text.length).toBeLessThanOrEqual(1800);

    // Aufbau: Rolle, „So arbeitest du:“, „Grenzen:“.
    expect(text.startsWith('Du bist ein geduldiger Lernbegleiter')).toBe(true);
    expect(text).toContain('\nSo arbeitest du:\n');
    expect(text).toContain('\nGrenzen:\n');
    expect(text.trim()).toBe(text.replace(/\n$/, ''));
    expect(text.endsWith('\n')).toBe(true);

    // Variablen: nur {{fach}}, und es kommt vor (außer im Text für das Fach „Standard“).
    const variables = [...text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]);
    expect(variables.every((name) => name === 'fach')).toBe(true);
    if (key !== 'standard') expect(variables.length).toBeGreaterThan(0);

    // Keine Steuerzeichen, kein Windows-Zeilenende, keine Zeilen mit Leerzeichen am Ende.
    expect(text).not.toMatch(/\r|\t/);
    expect(text).not.toMatch(/[ ]+$/m);

    for (const [label, pattern] of FORBIDDEN) {
      expect(text, `${file}: ${label}`).not.toMatch(pattern);
    }
  });

  it('nennt weder echte Namen noch Orte (Stichprobe häufiger Vornamen und Städte)', () => {
    const sample =
      /\b(Anna|Lena|Max|Paul|Lukas|Müller|Schmidt|Schneider|München|Köln|Frankfurt|Stuttgart|Leipzig|Dresden|Hannover)\b/;
    for (const file of files) expect(read(file), file).not.toMatch(sample);
  });

  it('lässt sich vollständig laden: keine Datei wird vom Lader verworfen', () => {
    const defaults = DefaultPrompts.load(dir, catalog);
    expect(defaults.keys()).toHaveLength(files.length);
  });

  it('findet für Chemie, Erdkunde und das Fach „Standard“ den passenden Text', () => {
    const defaults = DefaultPrompts.load(dir, catalog);
    expect(defaults.resolve(subject('Chemie'))?.key).toBe('chemie');
    expect(defaults.resolve(subject('Erdkunde'))?.key).toBe('geographie');
    expect(defaults.resolve(subject('Französisch'))?.key).toBe('franzoesisch');
    expect(defaults.resolve(subject('Mein eigenes Fach'))?.key).toBe('_generic');
    expect(
      defaults.resolve({ name: 'Standard', templateKey: 'standard', kind: 'default' })?.key,
    ).toBe('standard');
  });
});
