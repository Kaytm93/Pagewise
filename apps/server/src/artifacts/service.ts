import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { type ArtifactRow, artifacts } from '../db/schema';

/**
 * Dateien, die ein Modell über ein Werkzeug anlegt (D-074). Hier liegt nur die geprüfte Spezifikation als
 * JSON-Text; die Datei (PDF, PPTX …) entsteht beim Anzeigen und Herunterladen im Gerät. Der Server führt nichts
 * aus, was in einer Spezifikation steht, und liefert sie nur an die Oberfläche zurück.
 */

export type ArtifactKind = 'document' | 'slides' | 'sheet' | 'figure';
export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['document', 'slides', 'sheet', 'figure'];

/** Höchstzahl der Dateien, die eine Antwort anlegen darf. */
export const MAX_ARTIFACTS_PER_REPLY = 4;
/** Höchstzahl der Dateien je Chat. Mehr braucht niemand, und der Chat bleibt überschaubar. */
export const MAX_ARTIFACTS_PER_CHAT = 100;

/** Kurzfassung für die Nachrichtenliste: ohne Spezifikation. */
export interface ArtifactView {
  id: string;
  kind: ArtifactKind;
  title: string;
  version: number;
}

export interface ArtifactDetail extends ArtifactView {
  chatId: string;
  /** Geprüfte Spezifikation als JSON-Text, dieselbe Form wie der Inhalt des Blocks. */
  spec: string;
}

function isKind(value: string): value is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(value);
}

function toView(row: ArtifactRow): ArtifactView | null {
  if (!isKind(row.kind)) return null;
  return { id: row.id, kind: row.kind, title: row.title, version: row.version };
}

export class ArtifactService {
  constructor(private readonly db: Db) {}

  /** Legt eine Datei an die Antwort. `null`, wenn der Chat die Höchstzahl erreicht hat. */
  create(
    chatId: string,
    messageId: string,
    kind: ArtifactKind,
    title: string,
    spec: string,
  ): ArtifactView | null {
    const existing = this.db
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(eq(artifacts.chatId, chatId))
      .all();
    if (existing.length >= MAX_ARTIFACTS_PER_CHAT) return null;
    const row = this.db
      .insert(artifacts)
      .values({ chatId, messageId, kind, title, spec })
      .returning()
      .get();
    return toView(row);
  }

  /** Die Dateien der angegebenen Nachrichten, in der Reihenfolge des Anlegens. */
  forMessages(messageIds: string[]): Map<string, ArtifactView[]> {
    const map = new Map<string, ArtifactView[]>();
    if (messageIds.length === 0) return map;
    const rows = this.db
      .select()
      .from(artifacts)
      .where(inArray(artifacts.messageId, messageIds))
      .orderBy(artifacts.createdAt)
      .all();
    for (const row of rows) {
      const view = toView(row);
      if (!view) continue;
      const list = map.get(row.messageId) ?? [];
      list.push(view);
      map.set(row.messageId, list);
    }
    return map;
  }

  get(id: string): ArtifactDetail | null {
    const row = this.db.select().from(artifacts).where(eq(artifacts.id, id)).get();
    const view = row ? toView(row) : null;
    return row && view ? { ...view, chatId: row.chatId, spec: row.spec } : null;
  }
}
