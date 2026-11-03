import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceManager } from '../agents/workspace';
import { runSandboxed, type SandboxSpec, sandboxSupported } from '../sandbox/runner';
import { findTestPython } from '../sandbox/test-python';
import { locatePoppler, locateSoffice } from './locate';
import { PreviewError, PreviewService } from './render';

const CHAT = '11111111-1111-4111-8111-111111111111';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let base: string;
let workspace: string;
let manager: WorkspaceManager;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'pagewise-preview-')));
  const root = join(base, 'workspaces');
  mkdirSync(root);
  manager = new WorkspaceManager(root);
  workspace = manager.ensure(CHAT, null);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

/** Eine gültige PDF mit einer Seite, von Hand geschrieben (poppler baut die Verweistabelle selbst neu). */
function pdf(text: string): Buffer {
  const content = `BT /F1 24 Tf 20 100 Td (${text}) Tj ET`;
  return Buffer.from(
    `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${content.length}>>stream
${content}
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF
`,
  );
}

describe('PreviewService mit Ersatz-Programmen', () => {
  function service(calls: SandboxSpec[], overrides: { office?: boolean; raster?: boolean } = {}) {
    // Ersatzprogramme im Temp-Ordner: ausführbare Dateien, die nur gefunden werden müssen.
    const bin = mkdtempSync(join(base, 'bin-'));
    for (const name of ['soffice', 'pdftoppm', 'pdfinfo']) {
      if (name === 'soffice' && overrides.office === false) continue;
      if (name !== 'soffice' && overrides.raster === false) continue;
      writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    return new PreviewService({
      workspaces: manager,
      denyRead: [join(base, 'daten')],
      locate: { searchPath: bin, home: join(base, 'home'), system: false },
      tmpRoot: base,
      home: join(base, 'home'),
      platform: 'darwin',
      run: async (spec) => {
        calls.push(spec);
        const out = join(spec.workspace, 'out');
        if (spec.command.endsWith('soffice')) writeFileSync(join(out, 'input.pdf'), pdf('x'));
        if (spec.command.endsWith('pdfinfo')) {
          return {
            reason: 'exit',
            code: 0,
            signal: null,
            stdout: 'Pages:          7\n',
            stderr: '',
            outputTruncated: false,
            durationMs: 1,
          };
        }
        if (spec.command.endsWith('pdftoppm')) {
          for (const n of [1, 2, 3]) writeFileSync(join(out, `page-${n}.png`), PNG);
        }
        return {
          reason: 'exit',
          code: 0,
          signal: null,
          stdout: '',
          stderr: '',
          outputTruncated: false,
          durationMs: 1,
        };
      },
    });
  }

  it('wandelt Office-Dateien erst in PDF und rendert dann die Seiten', async () => {
    writeFileSync(join(workspace, 'folien.pptx'), 'x');
    const calls: SandboxSpec[] = [];
    const result = await service(calls).render({ chatId: CHAT, file: 'folien.pptx', pages: 3 });
    expect(result.pagesTotal).toBe(7);
    expect(result.pages.map((page) => page.number)).toEqual([1, 2, 3]);
    expect(calls.map((call) => call.command.split('/').pop())).toEqual([
      'soffice',
      'pdfinfo',
      'pdftoppm',
    ]);
    expect(calls[0]?.mode).toBe('office');
    expect(calls[1]?.mode).toBeUndefined();
  });

  it('sperrt für LibreOffice Benutzer-, Daten- und Datenträgerverzeichnis und deaktiviert Makros', async () => {
    writeFileSync(join(workspace, 'folien.pptx'), 'x');
    const calls: SandboxSpec[] = [];
    await service(calls).render({ chatId: CHAT, file: 'folien.pptx', pages: 1 });
    const office = calls[0] as SandboxSpec;
    expect(office.denyRead).toEqual(
      expect.arrayContaining([join(base, 'home'), '/Volumes', join(base, 'daten')]),
    );
    expect(office.workspace).toBe(office.cwd);
    // Eigene Umgebung ohne Schlüssel, eigenes Benutzerverzeichnis im Temp-Ordner.
    expect(Object.keys(office.env).sort()).toEqual([
      'HOME',
      'LANG',
      'PATH',
      'TMPDIR',
      'XDG_CACHE_HOME',
    ]);
    expect(office.env.HOME?.startsWith(office.workspace)).toBe(true);
    expect(office.args.some((arg) => arg.startsWith('-env:UserInstallation='))).toBe(true);
  });

  it('rendert eine PDF auch ohne LibreOffice, ohne es zu starten', async () => {
    writeFileSync(join(workspace, 'blatt.pdf'), pdf('Hallo'));
    const calls: SandboxSpec[] = [];
    const result = await service(calls, { office: false }).render({
      chatId: CHAT,
      file: 'blatt.pdf',
      pages: 1,
    });
    expect(result.pages.length).toBeGreaterThan(0);
    expect(calls.map((call) => call.command.split('/').pop())).toEqual(['pdfinfo', 'pdftoppm']);
    // Gerendert wird eine Kopie in einem eigenen Ordner, nicht die Datei im Arbeitsordner.
    expect(calls.every((call) => call.workspace !== workspace)).toBe(true);
  });

  it('braucht für Office-Dateien LibreOffice', async () => {
    writeFileSync(join(workspace, 'folien.pptx'), 'x');
    const error = (await service([], { office: false })
      .render({ chatId: CHAT, file: 'folien.pptx', pages: 1 })
      .catch((caught) => caught)) as PreviewError;
    expect(error.code).toBe('unavailable');
  });

  it('räumt den Temp-Ordner immer auf, auch bei Fehlern', async () => {
    writeFileSync(join(workspace, 'folien.pptx'), 'x');
    const failing = new PreviewService({
      workspaces: manager,
      denyRead: [],
      locate: { searchPath: join(base, 'bin'), system: false },
      tmpRoot: base,
      platform: 'darwin',
      run: async () => ({
        reason: 'exit',
        code: 1,
        signal: null,
        stdout: '',
        stderr: 'GEHEIM',
        outputTruncated: false,
        durationMs: 1,
      }),
    });
    mkdirSync(join(base, 'bin'), { recursive: true });
    for (const name of ['soffice', 'pdftoppm'])
      writeFileSync(join(base, 'bin', name), '#!/bin/sh\n', { mode: 0o755 });
    const error = await failing
      .render({ chatId: CHAT, file: 'folien.pptx', pages: 1 })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(PreviewError);
    expect((error as PreviewError).code).toBe('convert_failed');
    expect((error as Error).message).not.toContain('GEHEIM');
    expect(readdirSync(base).filter((name) => name.startsWith('pw-preview-'))).toEqual([]);
  });

  it('lehnt ungültige Namen, Typen, Verknüpfungen und fehlende Dateien ab', async () => {
    const svc = service([]);
    const code = async (file: string, pages = 1) =>
      ((await svc.render({ chatId: CHAT, file, pages }).catch((caught) => caught)) as PreviewError)
        .code;
    expect(await code('../geheim.pptx')).toBe('bad_name');
    expect(await code('ordner/folien.pptx')).toBe('bad_name');
    expect(await code('.run.pdf')).toBe('bad_name');
    expect(await code('.home')).toBe('bad_name');
    expect(await code('programm.sh')).toBe('bad_type');
    expect(await code('fehlt.pptx')).toBe('not_found');
    writeFileSync(join(base, 'draussen.pptx'), 'x');
    symlinkSync(join(base, 'draussen.pptx'), join(workspace, 'link.pptx'));
    expect(await code('link.pptx')).toBe('not_found');
    writeFileSync(join(workspace, 'leer.pptx'), '');
    expect(await code('leer.pptx')).toBe('too_large');
  });

  it('begrenzt die Seitenzahl auf sechs', async () => {
    writeFileSync(join(workspace, 'folien.pptx'), 'x');
    const calls: SandboxSpec[] = [];
    await service(calls).render({ chatId: CHAT, file: 'folien.pptx', pages: 99 });
    const raster = calls.find((call) => call.command.endsWith('pdftoppm')) as SandboxSpec;
    expect(raster.args[raster.args.indexOf('-l') + 1]).toBe('6');
  });

  it('bietet nichts an ohne LibreOffice oder ohne Rasterprogramm', () => {
    expect(service([], { office: false }).available()).toBe(false);
    expect(service([], { raster: false }).available()).toBe(false);
    expect(service([]).available()).toBe(true);
  });

  it('bietet nichts an, wo es keine Sandbox gibt', () => {
    const svc = new PreviewService({ workspaces: manager, denyRead: [], platform: 'linux' });
    expect(svc.available()).toBe(false);
  });
});

const real = sandboxSupported() && locateSoffice() && locatePoppler();
const python = real ? findTestPython() : null;

(real && python ? describe : describe.skip)(
  'PreviewService mit echtem LibreOffice und poppler (macOS)',
  () => {
    function docx(): string {
      if (!python) throw new Error('kein Python');
      const target = join(workspace, 'bericht.docx');
      execFileSync(
        python.python,
        [
          '-c',
          `import zipfile, sys
z = zipfile.ZipFile(sys.argv[1], "w")
z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
z.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
z.writestr("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Beispielbericht mit Umlauten äöü</w:t></w:r></w:p></w:body></w:document>')
z.close()`,
          target,
        ],
        { stdio: 'ignore' },
      );
      return target;
    }

    const live = () =>
      new PreviewService({
        workspaces: manager,
        denyRead: [join(base, 'daten')],
        tmpRoot: base,
      });

    it('rendert eine PDF zu einem PNG', async () => {
      writeFileSync(join(workspace, 'blatt.pdf'), pdf('Hallo Welt'));
      const result = await live().render({ chatId: CHAT, file: 'blatt.pdf', pages: 2 });
      expect(result.pagesTotal).toBe(1);
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0]?.png.subarray(0, 8).equals(PNG)).toBe(true);
      expect((result.pages[0]?.png.length ?? 0) > 500).toBe(true);
    }, 120_000);

    it('rendert eine DOCX über LibreOffice in der Sandbox zu einem PNG', async () => {
      docx();
      const result = await live().render({ chatId: CHAT, file: 'bericht.docx', pages: 3 });
      expect(result.pagesTotal).toBe(1);
      expect(result.pages[0]?.png.subarray(0, 8).equals(PNG)).toBe(true);
      // Der Temp-Ordner ist weg, der Arbeitsordner unverändert (nur die Quelle).
      expect(readdirSync(base).filter((name) => name.startsWith('pw-preview-'))).toEqual([]);
      expect(readdirSync(workspace)).toEqual(['bericht.docx']);
    }, 180_000);

    it('liest dabei nichts aus dem Benutzerverzeichnis und sendet nichts: LibreOffice-Profil sperrt das', async () => {
      // Das Profil selbst ist in profile.test.ts geprüft; hier zählt, dass es den echten Lauf nicht verhindert.
      docx();
      const calls: string[] = [];
      const svc = new PreviewService({
        workspaces: manager,
        denyRead: [join(base, 'daten')],
        tmpRoot: base,
        run: (spec, platform) => {
          calls.push(spec.mode ?? 'script');
          return runSandboxed(spec, platform);
        },
      });
      await svc.render({ chatId: CHAT, file: 'bericht.docx', pages: 1 });
      expect(calls).toEqual(['office', 'script', 'script']);
      expect(existsSync(join(workspace, 'bericht.pdf'))).toBe(false);
    }, 180_000);
  },
);
