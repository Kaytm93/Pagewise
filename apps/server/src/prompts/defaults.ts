import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  findCatalogEntryByName,
  KEY_PATTERN,
  type SubjectCatalog,
} from '../domain/subject-templates';

/**
 * Standard-Prompts je Fach (Entscheidung D-034): neutrale Texte, die für alle Nutzer gleich sind und
 * gelten, solange das Fach keinen eigenen Prompt hat. Sie liegen als Markdown-Dateien in
 * `prompts/defaults/<key>.md` im Repo. Schlüssel sind die der Katalogvorlagen (`config/subject-catalog.json`),
 * dazu `standard` für das eingebaute Fach „Standard“ und `_generic` als Rückfall für alle anderen Fächer.
 */

/** Längster Standardtext in Zeichen. Jede Nachricht bezahlt den Prompt mit, deshalb deutlich unter dem Maximum von 20.000. */
export const DEFAULT_PROMPT_MAX_CHARACTERS = 3000;
const MAX_FILE_BYTES = 16 * 1024;
const MAX_FILES = 300;

export const GENERIC_KEY = '_generic';
export const STANDARD_KEY = 'standard';
const FILE_KEY = new RegExp(`^(${GENERIC_KEY}|${KEY_PATTERN.source.slice(1, -1)})$`);

// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export interface DefaultPromptSource {
  /** Schlüssel der Datei, aus der der Text stammt (`_generic` bei Rückfall). */
  key: string;
  /** Der Text mit Variablen wie `{{fach}}`, noch nicht eingesetzt. */
  text: string;
}

/** Was Pagewise über ein Fach wissen muss, um seinen Standardtext zu finden. */
export interface PromptSubject {
  name: string;
  templateKey: string | null;
  kind: 'subject' | 'default';
}

export class DefaultPrompts {
  private constructor(
    private readonly texts: ReadonlyMap<string, string>,
    private readonly catalog: SubjectCatalog,
  ) {}

  /** Ohne Ordner oder mit unlesbaren Dateien gibt es einfach weniger (oder keine) Standardtexte. */
  static load(dir: string, catalog: SubjectCatalog): DefaultPrompts {
    const texts = new Map<string, string>();
    let names: string[];
    try {
      names = readdirSync(dir).filter((name) => name.endsWith('.md'));
    } catch {
      return new DefaultPrompts(texts, catalog);
    }
    for (const name of names.slice(0, MAX_FILES)) {
      const key = name.slice(0, -'.md'.length);
      if (!FILE_KEY.test(key)) continue;
      try {
        const file = join(dir, name);
        const stat = statSync(file);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
        const text = readFileSync(file, 'utf8')
          .replace(/\r\n?/g, '\n')
          .replace(/[ \t]+$/gm, '')
          .trim();
        if (text === '' || text.length > DEFAULT_PROMPT_MAX_CHARACTERS) continue;
        if (CONTROL_CHARACTERS.test(text)) continue;
        texts.set(key, text);
      } catch {
        // Eine unlesbare Datei darf den Start nicht verhindern.
      }
    }
    return new DefaultPrompts(texts, catalog);
  }

  /** Ohne Standardtexte (Tests und fehlender Ordner). */
  static empty(): DefaultPrompts {
    return new DefaultPrompts(new Map(), { categories: [], subjects: [] });
  }

  keys(): string[] {
    return [...this.texts.keys()].sort();
  }

  get(key: string): string | null {
    return this.texts.get(key) ?? null;
  }

  /**
   * Standardtext für ein Fach: das eingebaute Fach bekommt `standard`; sonst der Schlüssel der Vorlage,
   * aus der das Fach angelegt wurde; sonst die Vorlage zum Namen (so greift der Standard auch bei einem
   * von Hand getippten „Chemie“); zuletzt `_generic`. Gibt es nichts davon, kommt `null` zurück und der
   * Chat läuft ohne Fach-Prompt.
   */
  resolve(subject: PromptSubject): DefaultPromptSource | null {
    const candidates: (string | null)[] =
      subject.kind === 'default'
        ? [STANDARD_KEY]
        : [subject.templateKey, findCatalogEntryByName(this.catalog, subject.name)?.key ?? null];
    for (const key of [...candidates, GENERIC_KEY]) {
      if (key === null) continue;
      const text = this.texts.get(key);
      if (text !== undefined) return { key, text };
    }
    return null;
  }
}
