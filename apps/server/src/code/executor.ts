import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { AssetService, AssetView } from '../agents/assets';
import { snapshotDir, type WorkspaceManager } from '../agents/workspace';
import type { Db } from '../db/client';
import { type CodeRunRow, codeRuns } from '../db/schema';
import { buildCodeEnv, seedMatplotlibCache, WORKSPACE_HOME, WORKSPACE_TMP } from '../python/env';
import type { PythonRuntime } from '../python/runtime';
import type { SandboxGuard } from '../sandbox/probe';
import { treeStats } from '../sandbox/run-limited';
import { runSandboxed, type SandboxEnd } from '../sandbox/runner';

/**
 * Führt Python-Skripte aus, die ein Modell geschrieben hat (D-079). Alles läuft in der Sandbox (siehe
 * `sandbox/`), im Arbeitsordner des Chats `<Datenverzeichnis>/workspaces/<Chat-ID>`, ohne Netz und ohne Zugriff
 * auf das Datenverzeichnis, das Benutzerverzeichnis oder Schlüssel. Der Arbeitsordner bleibt für die Dauer des
 * Chats bestehen, damit spätere Aufrufe auf Zwischenergebnissen aufbauen; mit dem Chat verschwindet er.
 *
 * Skript und Ausgabe sind Fremdtext: Das Skript wird nur zum Anzeigen gespeichert, die Ausgabe gar nicht. Beides
 * steht nie in Logs oder Fehlermeldungen. Die Ausgabe geht als Daten an das Modell zurück.
 */

export const CODE_LIMITS = {
  timeoutMs: 60_000,
  maxOutputBytes: 1024 * 1024,
  /** Davon sieht das Modell: Anfang von stdout, Ende von stderr. */
  keepBytes: 3_000,
  maxMemoryBytes: 1024 * 1024 * 1024,
  maxWorkspaceBytes: 200 * 1024 * 1024,
  maxWorkspaceEntries: 5_000,
  maxScriptCharacters: 24_000,
  maxRunsPerReply: 6,
  maxRunsPerChat: 200,
  maxConcurrent: 2,
} as const;

/** Name des Skripts im Arbeitsordner. Versteckt, damit es nie als Ergebnisdatei zählt. */
export const SCRIPT_FILE = '.run.py';

export type CodeOutcome = 'ok' | 'error' | Exclude<SandboxEnd, 'exit' | 'spawn_failed'> | 'failed';

export interface CodeRunInput {
  chatId: string;
  messageId: string;
  script: string;
  purpose: string | null;
  signal?: AbortSignal | undefined;
}

export interface CodeRunResult {
  id: string | null;
  outcome: CodeOutcome;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  files: AssetView[];
}

/** Kurzfassung für die Nachrichtenliste. Das Skript steht erst im Detail (`get`). */
export interface CodeRunView {
  id: string;
  purpose: string | null;
  outcome: CodeOutcome;
  durationMs: number;
  files: string[];
}

export interface CodeRunDetail extends CodeRunView {
  chatId: string;
  script: string;
}

function parseFiles(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function toView(row: CodeRunRow): CodeRunView {
  return {
    id: row.id,
    purpose: row.purpose,
    outcome: row.outcome as CodeOutcome,
    durationMs: row.durationMs,
    files: parseFiles(row.files),
  };
}

export interface CodeExecutorOptions {
  db: Db;
  runtime: PythonRuntime;
  guard: SandboxGuard;
  workspaces: WorkspaceManager;
  assets: AssetService;
  timeZone?: string | undefined;
  /** Ersatz für die Sandbox, nur in Tests. */
  run?: typeof runSandboxed;
}

export class CodeExecutor {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly options: CodeExecutorOptions) {}

  /** Ob Code gerade ausgeführt werden kann: Python eingerichtet und die Sandbox sperrt (Selbsttest). */
  async ready(): Promise<boolean> {
    const info = this.options.runtime.info();
    if (!info) return false;
    const env = buildCodeEnv({
      sitePackages: info.sitePackages,
      workspace: this.options.runtime.layout.root,
      timeZone: this.options.timeZone,
    });
    const check = await this.options.guard.check({
      python: info.python,
      readOnly: info.readOnly,
      env,
    });
    return check.ok;
  }

  /** Zahl der Läufe dieses Chats, für die Grenze je Chat. */
  countForChat(chatId: string): number {
    return this.options.db
      .select({ id: codeRuns.id })
      .from(codeRuns)
      .where(eq(codeRuns.chatId, chatId))
      .all().length;
  }

  private async slot<T>(work: () => Promise<T>): Promise<T> {
    while (this.active >= CODE_LIMITS.maxConcurrent) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  async run(input: CodeRunInput): Promise<CodeRunResult> {
    const { db, runtime, workspaces, assets } = this.options;
    const info = runtime.info();
    const record = (
      outcome: CodeOutcome,
      exitCode: number | null,
      durationMs: number,
      files: string[],
    ) =>
      db
        .insert(codeRuns)
        .values({
          chatId: input.chatId,
          messageId: input.messageId,
          purpose: input.purpose,
          script: input.script,
          outcome,
          exitCode,
          durationMs,
          files: JSON.stringify(files),
        })
        .returning({ id: codeRuns.id })
        .get().id;
    if (!info) {
      return {
        id: record('unavailable', null, 0, []),
        outcome: 'unavailable',
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        truncated: false,
        files: [],
      };
    }

    const workspace = workspaces.ensure(input.chatId, null);
    for (const hidden of [WORKSPACE_HOME, WORKSPACE_TMP]) {
      mkdirSync(join(workspace, hidden), { recursive: true, mode: 0o700 });
    }
    seedMatplotlibCache(info.matplotlibCache, workspace);
    writeFileSync(join(workspace, SCRIPT_FILE), input.script, { mode: 0o600 });

    const result = await this.slot(async () => {
      const before = snapshotDir(workspace);
      // Ist der Ordner schon fast voll, darf der Lauf trotzdem aufräumen: Die Grenze gilt für das Wachstum.
      const used = treeStats(workspace, CODE_LIMITS.maxWorkspaceEntries * 4);
      const sandbox = await (this.options.run ?? runSandboxed)({
        command: info.python,
        args: ['-s', SCRIPT_FILE],
        cwd: workspace,
        workspace,
        readOnly: info.readOnly,
        env: buildCodeEnv({
          sitePackages: info.sitePackages,
          workspace,
          timeZone: this.options.timeZone,
        }),
        timeoutMs: CODE_LIMITS.timeoutMs,
        maxOutputBytes: CODE_LIMITS.maxOutputBytes,
        keepBytes: CODE_LIMITS.keepBytes,
        maxMemoryBytes: CODE_LIMITS.maxMemoryBytes,
        watchDir: workspace,
        maxDirBytes: Math.max(CODE_LIMITS.maxWorkspaceBytes, used.bytes + 50 * 1024 * 1024),
        maxDirEntries: Math.max(CODE_LIMITS.maxWorkspaceEntries, used.entries + 500),
        signal: input.signal,
      });
      // Ergebnisse sind nur Dateien im Hauptordner; Unterordner sind Arbeitsfläche des Skripts.
      const files = await assets.takeover(
        workspace,
        before,
        { chatId: input.chatId, messageId: input.messageId },
        (path) => !path.includes('/'),
      );
      return { sandbox, files };
    });

    const { sandbox, files } = result;
    const outcome: CodeOutcome =
      sandbox.reason === 'exit'
        ? sandbox.code === 0
          ? 'ok'
          : 'error'
        : sandbox.reason === 'spawn_failed'
          ? 'failed'
          : sandbox.reason;
    const id = record(
      outcome,
      sandbox.code,
      sandbox.durationMs,
      files.map((file) => file.name),
    );
    return {
      id,
      outcome,
      exitCode: sandbox.code,
      durationMs: sandbox.durationMs,
      stdout: sandbox.stdout,
      stderr: sandbox.stderr,
      truncated: sandbox.outputTruncated,
      files,
    };
  }

  forMessages(messageIds: string[]): Map<string, CodeRunView[]> {
    const map = new Map<string, CodeRunView[]>();
    if (messageIds.length === 0) return map;
    const rows = this.options.db
      .select()
      .from(codeRuns)
      .where(inArray(codeRuns.messageId, messageIds))
      .orderBy(codeRuns.createdAt)
      .all();
    for (const row of rows) {
      const list = map.get(row.messageId) ?? [];
      list.push(toView(row));
      map.set(row.messageId, list);
    }
    return map;
  }

  get(id: string): CodeRunDetail | null {
    const row = this.options.db.select().from(codeRuns).where(eq(codeRuns.id, id)).get();
    return row ? { ...toView(row), chatId: row.chatId, script: row.script } : null;
  }

  /** Entfernt den Arbeitsordner eines Chats (beim Löschen des Chats). */
  removeWorkspace(chatId: string): void {
    this.options.workspaces.removeSubject(chatId);
  }
}
