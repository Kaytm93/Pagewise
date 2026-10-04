import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { isInside } from '../data-dir';
import type { Db } from '../db/client';
import { type AssetRow, assets, chats } from '../db/schema';
import type { Storage } from '../storage/storage';
import { changedFiles, type Snapshot, snapshotDir } from './workspace';

/**
 * Dateien, die ein Agent in seinem Arbeitsordner erzeugt hat, werden als Assets übernommen und zum
 * Herunterladen angeboten (PDF, PPTX, Bilder …). Pagewise entscheidet über Art und Typ nach der Endung,
 * nie der Agent, und liefert Dateien nur als Download aus.
 */

export interface AssetView {
  id: string;
  name: string;
  kind: AssetKind;
  mime: string;
  size: number;
}

export type AssetKind = 'pdf' | 'pptx' | 'docx' | 'xlsx' | 'image' | 'text';

const TYPES: Record<string, { kind: AssetKind; mime: string }> = {
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  pptx: {
    kind: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  docx: {
    kind: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  xlsx: {
    kind: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  svg: { kind: 'image', mime: 'image/svg+xml' },
  txt: { kind: 'text', mime: 'text/plain; charset=utf-8' },
  md: { kind: 'text', mime: 'text/markdown; charset=utf-8' },
  csv: { kind: 'text', mime: 'text/csv; charset=utf-8' },
};

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const MAX_ASSETS_PER_RUN = 20;
const NAME_MAX = 100;

/** Dateiname zum Herunterladen: nur der Name (kein Pfad), ohne Steuerzeichen und Sonderzeichen, gekürzt. */
export function safeFileName(path: string): string {
  const base = basename(path).normalize('NFC');
  const ext = extname(base);
  const stem = base.slice(0, base.length - ext.length);
  const clean = (text: string) =>
    text
      .replace(/[^\p{L}\p{N}._ -]/gu, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^[. ]+/, '')
      .replace(/[. ]+$/, '')
      .trim();
  const cleanExt = clean(ext.slice(1)).toLowerCase();
  const suffix = cleanExt ? `.${cleanExt}` : '';
  const cleanStem = clean(stem).slice(0, NAME_MAX - suffix.length) || 'datei';
  return `${cleanStem}${suffix}`;
}

export function typeOf(path: string): { kind: AssetKind; mime: string } | null {
  return TYPES[extname(path).slice(1).toLowerCase()] ?? null;
}

export class AssetService {
  constructor(
    private readonly db: Db,
    private readonly storage: Storage,
  ) {}

  private toView(row: AssetRow): AssetView {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as AssetKind,
      mime: row.mime,
      size: row.size,
    };
  }

  /**
   * Übernimmt neue und geänderte Dateien aus dem Arbeitsordner. Übersprungen wird, was nicht passt:
   * unbekannte Endung, zu groß, kein gewöhnliche Datei oder aus dem Ordner herausführend.
   */
  async takeover(
    workspaceDir: string,
    before: Snapshot,
    target: { chatId: string; messageId: string },
  ): Promise<AssetView[]> {
    const root = realpathSync(workspaceDir);
    const taken: AssetView[] = [];
    for (const relativePath of changedFiles(before, snapshotDir(workspaceDir))) {
      if (taken.length >= MAX_ASSETS_PER_RUN) break;
      const type = typeOf(relativePath);
      if (!type) continue;
      const full = join(workspaceDir, relativePath);
      try {
        const stat = lstatSync(full);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ASSET_BYTES) continue;
        if (!isInside(realpathSync(full), root)) continue;
        const data = readFileSync(full);
        const id = randomUUID();
        await this.storage.put(id, data);
        const row = this.db
          .insert(assets)
          .values({
            id,
            chatId: target.chatId,
            messageId: target.messageId,
            kind: type.kind,
            mime: type.mime,
            name: safeFileName(relativePath),
            size: data.length,
          })
          .returning()
          .get();
        taken.push(this.toView(row));
      } catch {
        // Eine Datei, die sich nicht übernehmen lässt, stoppt die übrigen nicht.
      }
    }
    return taken;
  }

  /** Dateien je Nachricht, in der Reihenfolge ihrer Übernahme. */
  forMessages(messageIds: string[]): Map<string, AssetView[]> {
    const map = new Map<string, AssetView[]>();
    if (messageIds.length === 0) return map;
    const rows = this.db
      .select()
      .from(assets)
      .where(inArray(assets.messageId, messageIds))
      .orderBy(assets.createdAt, assets.name)
      .all();
    for (const row of rows) {
      const list = map.get(row.messageId) ?? [];
      list.push(this.toView(row));
      map.set(row.messageId, list);
    }
    return map;
  }

  get(id: string): AssetRow | undefined {
    return this.db.select().from(assets).where(eq(assets.id, id)).get();
  }

  async read(id: string): Promise<Uint8Array | null> {
    return this.storage.get(id);
  }

  // --- Aufräumen: Dateien auf der Platte folgen den Zeilen (Abschnitt 12.7) ---------------------

  /** IDs der Dateien eines Chats. Vor dem Löschen des Chats sammeln, danach `deleteFiles`. */
  idsForChat(chatId: string): string[] {
    return this.db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.chatId, chatId))
      .all()
      .map((row) => row.id);
  }

  idsForSubject(subjectId: string): string[] {
    const chatIds = this.db
      .select({ id: chats.id })
      .from(chats)
      .where(eq(chats.subjectId, subjectId))
      .all()
      .map((row) => row.id);
    if (chatIds.length === 0) return [];
    return this.db
      .select({ id: assets.id })
      .from(assets)
      .where(inArray(assets.chatId, chatIds))
      .all()
      .map((row) => row.id);
  }

  async deleteFiles(ids: string[]): Promise<void> {
    for (const id of ids) {
      try {
        await this.storage.delete(id);
      } catch {
        // Eine Datei, die sich nicht löschen lässt, darf das Löschen der übrigen nicht verhindern.
      }
    }
  }
}
