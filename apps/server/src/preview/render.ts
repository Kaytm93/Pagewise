import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { WorkspaceManager } from '../agents/workspace';
import { isInside } from '../data-dir';
import { runSandboxed, type SandboxResult, sandboxSupported } from '../sandbox/runner';
import { type LocateOptions, locatePoppler, locateSoffice } from './locate';

/**
 * Sichtprüfung (Stufe 3b, D-080): Eine Datei aus dem Arbeitsordner eines Chats (PPTX, DOCX, XLSX, PDF …) wird zu PDF
 * und zu PNG-Bildern der ersten Seiten gerendert, damit ein Modell mit Bildverstehen sie ansehen und das Skript
 * korrigieren kann. Alles läuft in der Sandbox:
 *
 * - LibreOffice (nur für Office-Dateien) im Profil `office`: kein Netz, Schreiben nur im Temp-Ordner dieses Laufs,
 *   Benutzer- und Datenverzeichnis nicht lesbar. Makros sind abgeschaltet.
 * - `pdftoppm` und `pdfinfo` im Skript-Profil: nur lesen im Programmordner, schreiben im Temp-Ordner.
 *
 * Die Datei wird zuerst in einen eigenen Temp-Ordner kopiert; der Arbeitsordner des Chats bleibt unberührt. Der
 * Temp-Ordner verschwindet nach jedem Lauf. Weder Dateiinhalt noch Bilder stehen in Logs oder Fehlermeldungen.
 */

export const PREVIEW_LIMITS = {
  defaultPages: 3,
  maxPages: 6,
  maxInputBytes: 25 * 1024 * 1024,
  maxImageBytes: 1_500_000,
  /** Längste Kante der Bilder in Pixeln. */
  imageSize: 1000,
  convertTimeoutMs: 90_000,
  rasterTimeoutMs: 60_000,
  maxPerReply: 4,
} as const;

const OFFICE_EXTENSIONS = new Set(['pptx', 'docx', 'xlsx', 'odp', 'odt', 'ods']);
const EXTENSIONS = new Set([...OFFICE_EXTENSIONS, 'pdf']);
/** Keine versteckten Dateien (der Arbeitsordner hat welche) und keine Pfade. */
const FILE_NAME = /^[\p{L}\p{N}_()][\p{L}\p{N}._ ()-]{0,99}$/u;

export class PreviewError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PreviewError';
  }
}

export interface PreviewPage {
  number: number;
  png: Buffer;
}

export interface PreviewResult {
  pagesTotal: number | null;
  pages: PreviewPage[];
}

export interface PreviewOptions {
  workspaces: WorkspaceManager;
  /** Orte, die LibreOffice nie lesen soll: Datenverzeichnis, Benutzerverzeichnis, Datenträger. */
  denyRead: readonly string[];
  locate?: LocateOptions;
  tmpRoot?: string;
  home?: string;
  run?: typeof runSandboxed;
  platform?: NodeJS.Platform;
}

/** Einstellungen von LibreOffice, die Makros abschalten (Sicherheitsstufe „sehr hoch“ und Ausführung aus). */
const NO_MACROS = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
</oor:items>
`;

export class PreviewService {
  private busy: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: PreviewOptions) {}

  private platform(): NodeJS.Platform {
    return this.options.platform ?? process.platform;
  }

  /** Was gerade da ist. Wird bei jeder Anfrage neu geprüft; die Suche ist billig. */
  capabilities(): { office: boolean; raster: boolean } {
    return {
      office: locateSoffice(this.options.locate) !== null,
      raster: locatePoppler(this.options.locate) !== null,
    };
  }

  /** Das Werkzeug gibt es nur mit Sandbox, LibreOffice und Rasterprogramm. */
  available(): boolean {
    if (!sandboxSupported(this.platform())) return false;
    const found = this.capabilities();
    return found.office && found.raster;
  }

  /** Rendert höchstens `pages` Seiten einer Datei aus dem Arbeitsordner des Chats. Einer nach dem anderen. */
  render(input: {
    chatId: string;
    file: string;
    pages: number;
    signal?: AbortSignal | undefined;
  }): Promise<PreviewResult> {
    const next = this.busy.then(
      () => this.renderNow(input),
      () => this.renderNow(input),
    );
    this.busy = next.catch(() => undefined);
    return next;
  }

  private async renderNow(input: {
    chatId: string;
    file: string;
    pages: number;
    signal?: AbortSignal | undefined;
  }): Promise<PreviewResult> {
    const run = this.options.run ?? runSandboxed;
    if (!FILE_NAME.test(input.file)) throw new PreviewError('bad_name');
    const extension = extname(input.file).slice(1).toLowerCase();
    if (!EXTENSIONS.has(extension)) throw new PreviewError('bad_type');
    const pages = Math.min(Math.max(1, Math.floor(input.pages)), PREVIEW_LIMITS.maxPages);

    const office = locateSoffice(this.options.locate);
    const poppler = locatePoppler(this.options.locate);
    if (!poppler || (OFFICE_EXTENSIONS.has(extension) && !office))
      throw new PreviewError('unavailable');

    // Die Quelle: eine gewöhnliche Datei im Hauptordner des Arbeitsordners, keine Verknüpfung.
    const workspace = this.options.workspaces.pathFor(input.chatId, null);
    const source = join(workspace, input.file);
    let size: number;
    try {
      const stat = lstatSync(source);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new PreviewError('not_found');
      if (!isInside(realpathSync(source), realpathSync(workspace)))
        throw new PreviewError('not_found');
      size = stat.size;
    } catch (error) {
      throw error instanceof PreviewError ? error : new PreviewError('not_found');
    }
    if (size === 0 || size > PREVIEW_LIMITS.maxInputBytes) throw new PreviewError('too_large');

    const root = realpathSync(mkdtempSync(join(this.options.tmpRoot ?? tmpdir(), 'pw-preview-')));
    try {
      for (const dir of ['in', 'out', 'home', 'tmp', 'cache', 'profile/user']) {
        mkdirSync(join(root, dir), { recursive: true, mode: 0o700 });
      }
      const input_ = join(root, 'in', `input.${extension}`);
      copyFileSync(source, input_);
      const env = (extra: Record<string, string> = {}): Record<string, string> => ({
        PATH: '/usr/bin:/bin',
        HOME: join(root, 'home'),
        TMPDIR: join(root, 'tmp'),
        LANG: 'en_US.UTF-8',
        XDG_CACHE_HOME: join(root, 'cache'),
        ...extra,
      });
      const outcome = (result: SandboxResult, code: string) => {
        if (result.reason === 'cancelled') throw new PreviewError('cancelled');
        if (result.reason === 'timeout') throw new PreviewError('timeout');
        if (result.reason === 'unavailable') throw new PreviewError('unavailable');
        if (result.reason !== 'exit' || result.code !== 0) throw new PreviewError(code);
      };

      // 1. Office-Datei zu PDF
      let pdf = input_;
      if (OFFICE_EXTENSIONS.has(extension) && office) {
        writeFileSync(join(root, 'profile', 'user', 'registrymodifications.xcu'), NO_MACROS, {
          mode: 0o600,
        });
        const home = this.options.home ?? homedir();
        const converted = await run({
          mode: 'office',
          command: office.path,
          args: [
            '--headless',
            '--norestore',
            '--nolockcheck',
            '--nodefault',
            '--nologo',
            `-env:UserInstallation=file://${join(root, 'profile')}`,
            '--convert-to',
            'pdf',
            '--outdir',
            join(root, 'out'),
            input_,
          ],
          cwd: root,
          workspace: root,
          readOnly: [],
          denyRead: [home, '/Volumes', ...this.options.denyRead],
          // Das Programm selbst und die Einstellungen, ohne die LibreOffice nicht startet.
          allowRead: [
            join(home, 'Library', 'Preferences'),
            join(home, 'Library', 'Caches'),
            join(home, 'Library', 'Fonts'),
            join(home, '.CFUserTextEncoding'),
            ...appFolder(office.path),
          ],
          env: env(),
          timeoutMs: PREVIEW_LIMITS.convertTimeoutMs,
          maxOutputBytes: 1024 * 1024,
          maxMemoryBytes: 2 * 1024 * 1024 * 1024,
          watchDir: root,
          maxDirBytes: 300 * 1024 * 1024,
          maxDirEntries: 5_000,
          signal: input.signal,
        });
        outcome(converted, 'convert_failed');
        pdf = join(root, 'out', 'input.pdf');
        if (!existsSync(pdf)) throw new PreviewError('convert_failed');
      }

      // 2. Seitenzahl und Bilder
      const rasterEnv = env();
      const posix = ['/opt/homebrew', '/usr/local', '/Library/Fonts'].filter((path) =>
        existsSync(path),
      );
      const base = {
        cwd: root,
        workspace: root,
        readOnly: posix,
        env: rasterEnv,
        maxOutputBytes: 1024 * 1024,
        maxMemoryBytes: 1024 * 1024 * 1024,
        signal: input.signal,
      } as const;
      let pagesTotal: number | null = null;
      if (poppler.pdfinfo) {
        const info = await run({
          ...base,
          command: poppler.pdfinfo,
          args: [pdf],
          timeoutMs: 20_000,
        });
        outcome(info, 'render_failed');
        const match = /^Pages:\s+(\d+)/m.exec(info.stdout);
        pagesTotal = match ? Number(match[1]) : null;
      }
      const raster = await run({
        ...base,
        command: poppler.pdftoppm,
        args: [
          '-png',
          '-r',
          '72',
          '-scale-to',
          String(PREVIEW_LIMITS.imageSize),
          '-f',
          '1',
          '-l',
          String(pages),
          pdf,
          join(root, 'out', 'page'),
        ],
        timeoutMs: PREVIEW_LIMITS.rasterTimeoutMs,
      });
      outcome(raster, 'render_failed');

      const names = readdirSync(join(root, 'out'))
        .filter((name) => /^page-\d+\.png$/.test(name))
        .sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]));
      if (names.length === 0) throw new PreviewError('render_failed');
      const rendered: PreviewPage[] = [];
      for (const name of names.slice(0, pages)) {
        const png = readFileSync(join(root, 'out', name));
        if (png.length > PREVIEW_LIMITS.maxImageBytes) throw new PreviewError('image_too_large');
        rendered.push({ number: Number(/\d+/.exec(name)?.[0]), png });
      }
      return { pagesTotal, pages: rendered };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

/** Die `.app`-Hülle eines Programms in `Contents/MacOS` (damit LibreOffice seine Bibliotheken lesen darf). */
function appFolder(program: string): string[] {
  const marker = '.app/';
  const index = program.indexOf(marker);
  return index === -1 ? [] : [program.slice(0, index + marker.length - 1)];
}
