import { fail, hasControlChars, LIMITS, ok, type RenderError, type Result } from './errors';

/** Eine Folie: Titel, optional Stichpunkte und ein Absatz. */
export interface Slide {
  title: string;
  bullets: string[];
  text: string | undefined;
}

export interface SlidesSpec {
  title: string;
  slides: Slide[];
}

/** Obergrenzen: eine Folie muss auf einem Bildschirm lesbar bleiben (Schriftgröße in der Datei ist fest). */
const MAX = {
  title: 120,
  slides: 20,
  slideTitle: 100,
  bullets: 6,
  bullet: 120,
  text: 500,
} as const;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnly = (value: Json, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

/** Text: nicht leer, nicht zu lang, ohne Steuerzeichen und Zeilenumbrüche. */
function readText(value: unknown, max: number): Result<string> {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > max ||
    hasControlChars(value) ||
    /[\r\n\t]/.test(value)
  ) {
    return fail('invalid_slides', 'text');
  }
  return ok(value);
}

function readSlide(entry: unknown): Result<Slide> {
  if (!isObject(entry) || !hasOnly(entry, ['title', 'bullets', 'text'])) {
    return fail('invalid_slides', 'slides');
  }
  const title = readText(entry.title, MAX.slideTitle);
  if (!title.ok) return title;

  const bullets: string[] = [];
  if (entry.bullets !== undefined) {
    const list = entry.bullets;
    if (!Array.isArray(list) || list.length > MAX.bullets) return fail('invalid_slides', 'bullets');
    for (const item of list) {
      const text = readText(item, MAX.bullet);
      if (!text.ok) return text;
      bullets.push(text.value);
    }
  }

  let text: string | undefined;
  if (entry.text !== undefined) {
    const value = readText(entry.text, MAX.text);
    if (!value.ok) return value;
    text = value.value;
  }
  return ok({ title: title.value, bullets, text });
}

/**
 * Liest den Inhalt eines ` ```slides `-Blocks (JSON): `title` und `slides`, eine Liste mit bis zu zwanzig Folien.
 * Je Folie `title` (Pflicht), optional `bullets` (bis sechs Stichpunkte) und `text` (ein Absatz). Unbekannte
 * Felder werden abgelehnt. Die Zeichen sind frei, PowerPoint kann Unicode.
 *
 * Fehler tragen als Hinweis nur den Namen des Feldes, nie Text aus der Eingabe.
 */
export function parseSlidesSpec(source: string): Result<SlidesSpec> {
  if (source.trim() === '') return fail('empty');
  if (source.length > LIMITS.slides) return fail('too_large');
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return fail('invalid_json');
  }
  if (!isObject(json) || !hasOnly(json, ['title', 'slides'])) return fail('invalid_slides');

  const title = readText(json.title, MAX.title);
  if (!title.ok) return title;

  const entries = json.slides;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX.slides) {
    return fail('invalid_slides', 'slides');
  }
  const slides: Slide[] = [];
  for (const entry of entries) {
    const slide = readSlide(entry);
    if (!slide.ok) return slide;
    slides.push(slide.value);
  }
  return ok({ title: title.value, slides });
}

/** Prüft einen ` ```slides `-Block, ohne ihn anzuzeigen. `null`, wenn er in Ordnung ist. */
export function validateSlides(source: string): RenderError | null {
  const spec = parseSlidesSpec(source);
  return spec.ok ? null : spec.error;
}
