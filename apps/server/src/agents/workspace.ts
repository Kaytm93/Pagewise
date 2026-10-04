import { lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isInside } from '../data-dir';

/**
 * Arbeitsordner der Agenten: ein eigener Ordner je Fach und je Untergruppe, direkt unter
 * `<Datenverzeichnis>/workspaces/<ID>`. Der Agent darf nichts außerhalb davon lesen oder schreiben (siehe
 * docs/agent-cli.md). Die Namen sind IDs, nie Texte des Nutzers: Das verhindert Pfadtricks und hält Fachnamen aus
 * dem Dateisystem. Der Pfad ist absichtlich flach: Die Sandbox von Claude Code erzeugt bei tiefen Pfaden ein
 * riesiges Profil, das nicht mehr startet (ab 11 Pfadbestandteilen gemessen), und jeder Bestandteil zählt.
 * Fach- und Untergruppen-IDs sind Zufalls-UUIDs und stoßen nicht aneinander.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILES = 5_000;
const MAX_DEPTH = 8;

export interface FileStat {
  size: number;
  mtimeMs: number;
}

/** Stand der Dateien in einem Ordner, Schlüssel ist der relative Pfad mit `/`. */
export type Snapshot = Map<string, FileStat>;

export class WorkspaceManager {
  constructor(private readonly root: string) {}

  /** Pfad des Arbeitsordners. Wirft bei ungültigen IDs, bevor irgendein Pfad entsteht. */
  pathFor(subjectId: string, groupId: string | null): string {
    if (!UUID.test(subjectId) || (groupId !== null && !UUID.test(groupId))) {
      throw new Error('Ungültige ID für einen Arbeitsordner.');
    }
    return join(this.root, groupId ?? subjectId);
  }

  /** Legt den Ordner mit Rechten 700 an und gibt den aufgelösten Pfad zurück. */
  ensure(subjectId: string, groupId: string | null): string {
    const path = this.pathFor(subjectId, groupId);
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const real = realpathSync(path);
    // Ein Symlink in der Kette dürfte den Ordner nie aus dem Datenverzeichnis herausführen.
    if (!isInside(real, realpathSync(this.root))) {
      throw new Error('Der Arbeitsordner führt aus dem Datenverzeichnis heraus.');
    }
    return real;
  }

  /** Entfernt den Arbeitsordner eines Fachs und die seiner Untergruppen (deren IDs kennt nur die Datenbank). */
  removeSubject(subjectId: string, groupIds: readonly string[] = []): void {
    if (!UUID.test(subjectId)) return;
    rmSync(join(this.root, subjectId), { recursive: true, force: true });
    for (const groupId of groupIds) this.removeGroup(subjectId, groupId);
  }

  removeGroup(subjectId: string, groupId: string): void {
    if (!UUID.test(subjectId) || !UUID.test(groupId)) return;
    rmSync(this.pathFor(subjectId, groupId), { recursive: true, force: true });
  }
}

/**
 * Liest den Stand der Dateien eines Arbeitsordners: nur gewöhnliche Dateien (keine Verknüpfungen), keine
 * versteckten Ordner und Dateien (`.claude` und Ähnliches), begrenzt in Tiefe und Anzahl.
 */
export function snapshotDir(dir: string): Snapshot {
  const result: Snapshot = new Map();
  const walk = (current: string, depth: number): void => {
    if (depth > MAX_DEPTH || result.size >= MAX_FILES) return;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (name.startsWith('.')) continue;
      if (result.size >= MAX_FILES) return;
      const full = join(current, name);
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(full, depth + 1);
      else if (stat.isFile()) {
        result.set(relative(dir, full).split(sep).join('/'), {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      }
    }
  };
  walk(dir, 0);
  return result;
}

/** Dateien, die neu sind oder sich seit `before` geändert haben (Größe oder Zeitstempel), sortiert. */
export function changedFiles(before: Snapshot, after: Snapshot): string[] {
  const changed: string[] = [];
  for (const [path, stat] of after) {
    const old = before.get(path);
    if (!old || old.size !== stat.size || old.mtimeMs !== stat.mtimeMs) changed.push(path);
  }
  return changed.sort();
}
