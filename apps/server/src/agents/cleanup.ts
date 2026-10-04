import { eq } from 'drizzle-orm';
import type { ChatService } from '../chats/service';
import type { Db } from '../db/client';
import { chats, subjectGroups, subjects } from '../db/schema';
import type { AssetService } from './assets';
import type { WorkspaceManager } from './workspace';

/**
 * Räumt auf, wenn ein Fach oder eine Untergruppe gelöscht wird: laufende Antworten werden beendet, die
 * erzeugten Dateien (`assets/`) und die Arbeitsordner (`workspaces/`) verschwinden mit. Die Datenbankzeilen
 * löscht die Datenbank selbst (Fremdschlüssel); Dateien auf der Platte kennt sie nicht (Abschnitt 12.7).
 *
 * Aufruf: erst `before…`, dann die Zeile löschen, bei Erfolg den zurückgegebenen Abschluss ausführen.
 */
export type Finalizer = () => Promise<void>;

export class AgentCleanup {
  constructor(
    private readonly db: Db,
    private readonly chatService: ChatService,
    private readonly assets: AssetService,
    private readonly workspaces: WorkspaceManager,
  ) {}

  /** `null`: das Fach gibt es nicht oder es ist das eingebaute „Standard“ (nicht löschbar), dann ist nichts zu tun. */
  async beforeSubjectDelete(subjectId: string): Promise<Finalizer | null> {
    const subject = this.db.select().from(subjects).where(eq(subjects.id, subjectId)).get();
    if (!subject || subject.kind === 'default') return null;
    const chatIds = this.db
      .select({ id: chats.id })
      .from(chats)
      .where(eq(chats.subjectId, subjectId))
      .all()
      .map((row) => row.id);
    await this.chatService.stopChats(chatIds);
    const files = this.assets.idsForSubject(subjectId);
    // Die Untergruppen sind nach dem Löschen aus der Datenbank verschwunden: ihre IDs jetzt vormerken.
    const groupIds = this.db
      .select({ id: subjectGroups.id })
      .from(subjectGroups)
      .where(eq(subjectGroups.subjectId, subjectId))
      .all()
      .map((row) => row.id);
    return async () => {
      await this.assets.deleteFiles(files);
      this.workspaces.removeSubject(subjectId, groupIds);
    };
  }

  async beforeGroupDelete(groupId: string): Promise<Finalizer | null> {
    const group = this.db.select().from(subjectGroups).where(eq(subjectGroups.id, groupId)).get();
    if (!group) return null;
    const chatIds = this.db
      .select({ id: chats.id })
      .from(chats)
      .where(eq(chats.groupId, groupId))
      .all()
      .map((row) => row.id);
    await this.chatService.stopChats(chatIds);
    const files = chatIds.flatMap((id) => this.assets.idsForChat(id));
    return async () => {
      await this.assets.deleteFiles(files);
      this.workspaces.removeGroup(group.subjectId, groupId);
    };
  }
}
