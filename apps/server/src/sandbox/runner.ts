import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildOfficeProfile, buildSeatbeltProfile } from './profile';
import { type LimitedEnd, type LimitedSpec, runLimited } from './run-limited';

/**
 * Führt ein Programm in der Sandbox aus (macOS: `sandbox-exec` mit einem Profil aus `profile.ts`, D-079). Es gibt
 * keinen Weg, die Sandbox zu überspringen: Wo sie fehlt oder das Profil nicht entsteht, läuft nichts
 * (`unavailable`), statt ungeschützt zu starten.
 *
 * `sandbox-exec` meldet sich als veraltet, ein Ersatz für Fremdprogramme ist nicht bekannt. Darum prüft
 * `selfTest` (probe.ts) vor dem ersten Lauf, ob die Sandbox in dieser Umgebung wirklich sperrt.
 */

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

export function sandboxSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin';
}

export interface SandboxSpec extends Omit<LimitedSpec, 'command' | 'args'> {
  /** Programm, absolut. Es muss unter `readOnly` oder `workspace` liegen oder zum System gehören. */
  command: string;
  args: readonly string[];
  /** Arbeitsordner: hier darf das Programm lesen und schreiben. Er ist auch `cwd`. */
  workspace: string;
  /** Ordner, die nur gelesen werden dürfen (Python, Pakete). */
  readOnly: readonly string[];
  /**
   * `script` (Standard): alles verboten, nur Nötiges erlaubt, kein `fork`. `office`: für LibreOffice, siehe
   * `buildOfficeProfile`; `denyRead` und `allowRead` gelten nur dort.
   */
  mode?: 'script' | 'office';
  denyRead?: readonly string[];
  allowRead?: readonly string[];
}

export type SandboxEnd = LimitedEnd | 'unavailable';

export interface SandboxResult {
  reason: SandboxEnd;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  durationMs: number;
}

/** Alle Verzeichnisse oberhalb eines Pfads, ohne die Wurzel. */
function ancestors(path: string): string[] {
  const result: string[] = [];
  for (
    let current = dirname(path);
    current !== '/' && current !== '.';
    current = dirname(current)
  ) {
    result.push(current);
  }
  return result;
}

const unavailable = (): SandboxResult => ({
  reason: 'unavailable',
  code: null,
  signal: null,
  stdout: '',
  stderr: '',
  outputTruncated: false,
  durationMs: 0,
});

export async function runSandboxed(
  spec: SandboxSpec,
  platform: NodeJS.Platform = process.platform,
): Promise<SandboxResult> {
  if (!sandboxSupported(platform)) return unavailable();
  let profile: string;
  let command: string;
  try {
    // Das Profil vergleicht echte Pfade: Symlinks (zum Beispiel `/tmp`, ein venv) werden vorher aufgelöst.
    const workspace = realpathSync(spec.workspace);
    const existing = (paths: readonly string[] | undefined) =>
      (paths ?? []).flatMap((path) => {
        try {
          return [realpathSync(path)];
        } catch {
          return [];
        }
      });
    if (spec.mode === 'office') {
      const allowRead = existing(spec.allowRead);
      profile = buildOfficeProfile({
        workspace,
        denyRead: existing(spec.denyRead),
        allowRead,
        // Vorfahren der Ausnahmen unter gesperrten Orten dürfen aufgelistet werden (sonst startet LibreOffice nicht).
        allowList: [...new Set([workspace, ...allowRead].flatMap(ancestors))],
      });
    } else {
      profile = buildSeatbeltProfile({
        workspace,
        readOnly: spec.readOnly.map((path) => realpathSync(path)),
      });
    }
    command = realpathSync(spec.command);
  } catch {
    return unavailable();
  }
  const result = await runLimited({
    ...spec,
    command: SANDBOX_EXEC,
    args: ['-p', profile, command, ...spec.args],
  });
  // `sandbox-exec` scheitert vor dem Start, wenn das Profil nicht gilt (zum Beispiel in einer fremden Sandbox).
  if (result.reason === 'exit' && result.code === 71 && result.stderr.startsWith('sandbox-exec:')) {
    return unavailable();
  }
  return result;
}
