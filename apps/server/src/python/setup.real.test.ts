import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceManager } from '../agents/workspace';
import { PreviewService } from '../preview/render';
import { SandboxGuard } from '../sandbox/probe';
import { runSandboxed, sandboxSupported } from '../sandbox/runner';
import { buildCodeEnv, seedMatplotlibCache } from './env';
import { REQUIREMENTS_LOCK } from './lock';
import { platformKey } from './pins';
import { PythonRuntime } from './runtime';
import { PythonSetup } from './setup';

/**
 * Echte Einrichtung des privaten Python (D-079): lädt den festgenagelten Build von GitHub und die Pakete aus dem Lock
 * von PyPI in einen Ordner und führt danach in der echten Sandbox ein Skript mit den Paketen aus. Außerdem rendert sie
 * die erzeugten Office-Dateien über die Sichtprüfung (D-080).
 *
 * Läuft nur mit `PAGEWISE_E2E_PYTHON_SETUP=<leerer Ordner>` (zum Beispiel `~/pagewise-agent/data-3191`) und braucht
 * Netz. Der Ordner wird vorher geleert. Nie auf das Datenverzeichnis einer echten App richten. Ist
 * `PAGEWISE_E2E_KEEP=1` gesetzt, bleibt die Einrichtung für weitere Läufe stehen.
 */
const DIR = process.env.PAGEWISE_E2E_PYTHON_SETUP;
const key = platformKey();
const enabled = Boolean(DIR && key && sandboxSupported() && REQUIREMENTS_LOCK[key]);

const SCRIPT = `import csv
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches, Pt
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import xlsxwriter

# Diagramm als PNG
fig, ax = plt.subplots(figsize=(5, 3))
ax.bar(["A", "B", "C"], [3, 5, 2])
ax.set_title("Beispiel-Diagramm")
fig.savefig("diagramm.png", dpi=100)
fig.savefig("diagramm.svg")

# Präsentation
prs = Presentation()
slide = prs.slides.add_slide(prs.slide_layouts[5])
slide.shapes.title.text = "Beispiel-Folie mit Umlauten äöü"
box = slide.shapes.add_textbox(Inches(1), Inches(2), Inches(8), Inches(1))
box.text_frame.text = "Freier Aufbau mit python-pptx"
box.text_frame.paragraphs[0].runs[0].font.size = Pt(28)
slide.shapes.add_picture("diagramm.png", Inches(2), Inches(3.2), width=Inches(5))
prs.save("folien.pptx")

# Word
doc = Document()
doc.add_heading("Beispielbericht", 0)
doc.add_paragraph("Ein Absatz mit Umlauten äöü ß.")
doc.save("bericht.docx")

# Excel (zwei Wege)
wb = Workbook()
wb.active.append(["x", "y"])
wb.active.append([1, 2])
wb.save("tabelle.xlsx")
book = xlsxwriter.Workbook("tabelle2.xlsx")
book.add_worksheet().write_row(0, 0, ["a", "b"])
book.close()

# PDF
pdf = canvas.Canvas("blatt.pdf", pagesize=A4)
pdf.setFont("Helvetica", 18)
pdf.drawString(72, 760, "Beispielblatt mit reportlab")
pdf.save()

with open("werte.csv", "w", newline="") as handle:
    csv.writer(handle, delimiter=";").writerows([["x", "y"], [1, 2]])
print("fertig")
`;

(enabled ? describe : describe.skip)('Echte Einrichtung und Läufe mit dem privaten Python', () => {
  it('richtet ein, führt ein Skript mit allen Paketen in der Sandbox aus und rendert die Dateien', async () => {
    const dir = realpathSync(DIR as string);
    if (process.env.PAGEWISE_E2E_KEEP !== '1' || !existsSync(join(dir, 'python', 'ready.json'))) {
      for (const name of readdirSync(dir))
        rmSync(join(dir, name), { recursive: true, force: true });
    }
    const runtime = new PythonRuntime(dir);
    const guard = new SandboxGuard();
    if (runtime.state() !== 'ready') {
      const setup = new PythonSetup({
        runtime,
        guard,
        platform: key,
        lock: REQUIREMENTS_LOCK[key as 'darwin-arm64'] ?? null,
      });
      await setup.start();
      expect(setup.status()).toEqual({ state: 'ready', phase: null, progress: null, error: null });
    }
    expect(runtime.state()).toBe('ready');
    const info = runtime.info();
    expect(info).not.toBeNull();
    if (!info) return;

    // Das Python gehört Pagewise: Es liegt unter dem Datenverzeichnis, nicht im System.
    expect(info.python.startsWith(dir)).toBe(true);

    // Ein echtes Skript in der Sandbox: alle Pakete, alle Formate.
    const workspaces = new WorkspaceManager(join(dir, 'workspaces'));
    mkdirSync(join(dir, 'workspaces'), { recursive: true });
    const chat = '22222222-2222-4222-8222-222222222222';
    const workspace = workspaces.ensure(chat, null);
    for (const hidden of ['.home', '.tmp']) mkdirSync(join(workspace, hidden), { recursive: true });
    seedMatplotlibCache(info.matplotlibCache, workspace);
    writeFileSync(join(workspace, '.run.py'), SCRIPT);
    const started = Date.now();
    const result = await runSandboxed({
      command: info.python,
      args: ['-s', '.run.py'],
      cwd: workspace,
      workspace,
      readOnly: info.readOnly,
      env: buildCodeEnv({
        sitePackages: info.sitePackages,
        workspace,
      }),
      timeoutMs: 120_000,
      maxOutputBytes: 1024 * 1024,
      maxMemoryBytes: 1024 * 1024 * 1024,
      watchDir: workspace,
      maxDirBytes: 200 * 1024 * 1024,
    });
    console.log(
      `Skript mit Paketen: ${((Date.now() - started) / 1000).toFixed(1)} s, Ausgang ${result.reason}`,
    );
    expect(result.stderr).toBe('');
    expect(result).toMatchObject({ reason: 'exit', code: 0, stdout: 'fertig\n' });
    for (const name of [
      'folien.pptx',
      'bericht.docx',
      'tabelle.xlsx',
      'tabelle2.xlsx',
      'blatt.pdf',
      'diagramm.png',
      'diagramm.svg',
      'werte.csv',
    ]) {
      expect(statSync(join(workspace, name)).size, name).toBeGreaterThan(
        name === 'werte.csv' ? 5 : 100,
      );
    }
    expect(readFileSync(join(workspace, 'folien.pptx')).subarray(0, 2).toString()).toBe('PK');
    expect(readFileSync(join(workspace, 'blatt.pdf')).subarray(0, 4).toString()).toBe('%PDF');
    expect(readFileSync(join(workspace, 'diagramm.png')).subarray(1, 4).toString()).toBe('PNG');

    // Sichtprüfung der Office-Dateien mit echtem LibreOffice und poppler.
    const preview = new PreviewService({ workspaces, denyRead: [dir] });
    if (preview.available()) {
      for (const file of ['folien.pptx', 'bericht.docx', 'tabelle.xlsx', 'blatt.pdf']) {
        const rendered = await preview.render({ chatId: chat, file, pages: 2 });
        console.log(
          `Vorschau ${file}: ${rendered.pagesTotal} Seite(n), ${rendered.pages.map((page) => `${page.png.length} B`).join(', ')}`,
        );
        expect(rendered.pages.length).toBeGreaterThan(0);
        expect(rendered.pages[0]?.png.subarray(1, 4).toString()).toBe('PNG');
        if (file === 'folien.pptx')
          writeFileSync(join(dir, 'vorschau-folien.png'), rendered.pages[0]?.png as Buffer);
      }
    } else {
      console.log('Sichtprüfung übersprungen: LibreOffice oder poppler fehlt.');
    }
  }, 1_800_000);
});
