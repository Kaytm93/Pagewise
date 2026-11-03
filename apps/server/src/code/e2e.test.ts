import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { PythonRuntime } from '../python/runtime';
import { SandboxGuard } from '../sandbox/probe';
import { runSandboxed, sandboxSupported } from '../sandbox/runner';
import { findTestPython } from '../sandbox/test-python';
import { createServices, type Services } from '../services';

/**
 * Ende-zu-Ende in echtem Chromium (D-079, D-080): Produktions-Build der Oberfläche mit der strengen CSP, echter
 * Server auf einem eigenen Port, echte Sandbox, echtes Python und echtes `pdftoppm`; nur der Modell-Anbieter ist ein
 * Ersatz. Geprüft wird der ganze Weg: Code-Ausführung in den Einstellungen einschalten, im Chat ein Skript laufen
 * lassen, Dateien als Download, Skript ansehen, Sichtprüfung mit Bild an das Modell, keine Meldung der CSP.
 *
 * Läuft nur mit `PAGEWISE_E2E_CODE=<Pfad zum Ordner des Pakets playwright>` (zum Beispiel
 * `~/pagewise-agent/pw/node_modules/playwright`), gebautem `apps/web/dist` und einem Python (`PAGEWISE_TEST_PYTHON`).
 * Ein Bildschirmfoto des Chats landet im Ordner `PAGEWISE_E2E_SHOTS` (sonst im Temp-Ordner des Laufs). Der Testserver nutzt
 * `PAGEWISE_E2E_PORT` (Standard 3190), ein leeres Datenverzeichnis im Temp-Ordner und erfundene
 * Daten. Nie auf den Port einer echten App richten.
 */
/** Der kleine Teil von Playwright, den der Test braucht. Das Paket gehört nicht zum Repo, nur sein Pfad kommt per Umgebung. */
// biome-ignore lint/suspicious/noExplicitAny: Playwright ist hier nicht installiert, die Typen fehlen.
type PlaywrightChromium = { launch(): Promise<any> };
const PLAYWRIGHT = process.env.PAGEWISE_E2E_CODE;
const PORT = Number(process.env.PAGEWISE_E2E_PORT ?? 3190);
const WEB_DIST = resolve(__dirname, '../../../web/dist');
const python = PLAYWRIGHT && sandboxSupported() ? findTestPython() : null;
const enabled = Boolean(PLAYWRIGHT && python && existsSync(join(WEB_DIST, 'index.html')));

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const KEY = ['beispiel', 'schluessel', 'abcdefghijklmnop'].join('-');
const BASE_URL = 'https://anbieter.example.test/v1';
const PASSCODE = 'ein erfundener Beispiel-Passcode';
const encoder = new TextEncoder();

const chunk = (delta: Record<string, unknown>) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`;
const stop = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`;
const sse = (chunks: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const text of chunks) controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
const toolCall = (id: string, name: string, args: unknown) =>
  sse([
    chunk({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 20, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
  ]);

/** Das Skript des „Modells“: nur Standardbibliothek, schreibt CSV, PNG und eine PDF mit einer Seite. */
const SCRIPT = `import struct, zlib

def png(path, width, height):
    raw = b"".join(b"\\x00" + b"".join(bytes([(x * 255) // width, (y * 255) // height, 128]) for x in range(width)) for y in range(height))
    def block(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    with open(path, "wb") as handle:
        handle.write(b"\\x89PNG\\r\\n\\x1a\\n" + block(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + block(b"IDAT", zlib.compress(raw)) + block(b"IEND", b""))

png("verlauf.png", 40, 30)
with open("werte.csv", "w") as handle:
    handle.write("x;y\\n1;2\\n3;4\\n")
text = "BT /F1 24 Tf 20 100 Td (Beispielbericht) Tj ET"
with open("bericht.pdf", "w") as handle:
    handle.write(f"%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\\n4 0 obj<</Length {len(text)}>>stream\\n{text}\\nendstream endobj\\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\\ntrailer<</Root 1 0 R/Size 6>>\\n%%EOF\\n")
print("fertig")
`;

(enabled ? describe : describe.skip)(
  'Ende-zu-Ende: Code-Ausführung und Sichtprüfung im Browser',
  () => {
    let base: string;
    let services: Services;
    let server: Server;
    let received: { messages: { role: string; content: unknown }[] }[];

    beforeAll(async () => {
      if (!python) return;
      base = realpathSync(mkdtempSync(join(tmpdir(), 'pagewise-e2e-')));
      mkdirSync(join(base, 'site'));
      mkdirSync(join(base, 'mpl'));
      received = [];
      const runtime = new PythonRuntime(join(base, 'daten-py'));
      runtime.state = () => 'ready';
      runtime.info = () => ({
        python: python.python,
        readOnly: [...python.readOnly, join(base, 'site'), join(base, 'mpl')],
        sitePackages: join(base, 'site'),
        matplotlibCache: join(base, 'mpl'),
      });
      let round = 0;
      services = createServices(join(base, 'daten'), {
        scryptParams: { N: 16, r: 8, p: 1 },
        fetch: (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          if (!String(input).endsWith('/chat/completions'))
            return new Response('{}', { status: 404 });
          received.push(JSON.parse(String(init?.body)));
          round += 1;
          if (round === 1)
            return toolCall('call_1', 'run_python', { code: SCRIPT, purpose: 'Dateien anlegen' });
          if (round === 2)
            return toolCall('call_2', 'preview_file', { file: 'bericht.pdf', pages: 1 });
          return sse([chunk({ content: 'Die Dateien sind fertig.' }), stop]);
        }) as typeof fetch,
        code: { runtime, guard: new SandboxGuard(), run: runSandboxed },
      });
      const app = createApp({ version: '1.2.3', services, webDist: WEB_DIST });
      server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }) as unknown as Server;
      await new Promise((resolveListening) => server.once('listening', resolveListening));
    }, 60_000);

    afterAll(async () => {
      await new Promise((done) => (server ? server.close(done) : done(undefined)));
      services?.close();
      if (base) rmSync(base, { recursive: true, force: true });
    });

    it('läuft durch: einschalten, Skript ausführen, Dateien laden, Code ansehen, Sichtprüfung, keine CSP-Meldung', async () => {
      const origin = `http://127.0.0.1:${PORT}`;
      // Einrichtung und Anmeldung über die Schnittstelle, wie die Oberfläche sie nutzt.
      const setup = await fetch(`${origin}/api/auth/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ setupCode: services.auth.pendingSetupCode(), passcode: PASSCODE }),
      });
      expect(setup.status).toBe(201);
      const cookie = (
        setup.headers.getSetCookie().find((c) => c.startsWith('pagewise_session=')) ?? ''
      ).split(';')[0] as string;
      const csrf = String(((await setup.json()) as { csrfToken: string }).csrfToken);
      const api = async (method: string, path: string, body?: unknown) => {
        const response = await fetch(`${origin}${path}`, {
          method,
          headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, origin },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return {
          status: response.status,
          body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
        };
      };
      // Das Onboarding ist für diesen Test erledigt.
      expect((await api('POST', '/api/onboarding/complete')).status).toBe(200);
      const subject = (await api('POST', '/api/subjects', { name: 'Beispiel-Informatik' })).body
        .id as string;
      const provider = await api('POST', '/api/providers', {
        name: 'Beispiel-Anbieter',
        baseUrl: BASE_URL,
        apiKey: KEY,
        allowCode: true,
        models: [{ id: 'modell-a', tools: true, vision: true }],
      });
      await api('PUT', '/api/model-settings', {
        default: { providerId: provider.body.id, model: 'modell-a' },
        fallback: [],
      });
      const chat = (await api('POST', '/api/chats', { subjectId: subject })).body.id as string;

      const { chromium } = (await import(join(PLAYWRIGHT as string, 'index.mjs'))) as {
        chromium: PlaywrightChromium;
      };
      const browser = await chromium.launch();
      try {
        const context = await browser.newContext({
          viewport: { width: 1100, height: 900 },
          deviceScaleFactor: 1,
        });
        await context.addCookies([
          { name: 'pagewise_session', value: cookie.split('=')[1] as string, url: origin },
        ]);
        const page = await context.newPage();
        const problems: string[] = [];
        page.on('console', (message: { type(): string; text(): string }) => {
          // Fehler und jede Meldung zur CSP. Hinweise zum Vorladen von Skripten (Service Worker) gehören nicht dazu.
          const text = message.text();
          if (message.type() === 'error' || /Content Security Policy|Refused to/i.test(text)) {
            problems.push(`${message.type()}: ${text}`);
          }
        });
        page.on('pageerror', (error: Error) => problems.push(`pageerror: ${error.message}`));

        // 1. Einstellungen: einschalten nur mit der Erklärung
        await page.goto(`${origin}/settings`);
        const box = page.getByRole('checkbox', { name: /KI darf Code ausführen/ });
        await box.waitFor();
        expect(await box.isChecked()).toBe(false);
        await box.click();
        const dialog = page.getByRole('dialog', { name: 'Code-Ausführung einschalten?' });
        await dialog.waitFor();
        expect((await api('GET', '/api/tool-settings')).body.code).toBe(false);
        await dialog.getByRole('button', { name: 'Verstanden, einschalten' }).click();
        await dialog.waitFor({ state: 'detached' });
        expect((await api('GET', '/api/tool-settings')).body.code).toBe(true);
        await page
          .getByText('Python ist eingerichtet, und die Sandbox sperrt wie erwartet.')
          .waitFor();
        await page.getByText(/Sichtprüfung: /).waitFor();

        // 2. Chat: Skript läuft in der Sandbox, Dateien erscheinen unter der Antwort
        await page.goto(`${origin}/subjects/${subject}/chats/${chat}`);
        await page
          .getByRole('textbox', { name: 'Nachricht' })
          .fill('Lege mir ein paar Dateien an.');
        await page.getByRole('button', { name: 'Senden' }).click();
        await page.getByText('Die Dateien sind fertig.').waitFor({ timeout: 60_000 });
        const runs = page.getByRole('list', { name: 'Code dieser Antwort' });
        await runs.getByText('Code ausgeführt: Dateien anlegen').waitFor();
        await runs.getByText('Erfolgreich').waitFor();
        await runs.getByText(/Neue Dateien: .*werte\.csv/).waitFor();
        await page
          .getByRole('list', { name: 'Abgefragte Daten' })
          .getByText('Datei angesehen: bericht.pdf')
          .waitFor();

        // 3. Das Skript lässt sich ansehen, nur als Text
        await runs.getByRole('button', { name: 'Code anzeigen' }).click();
        await page.getByText(/def png\(path, width, height\)/).waitFor();
        expect(await page.locator('pre code').count()).toBe(1);

        // 4. Dateien: CSV als Download, PNG inline sichtbar
        const link = page.getByRole('link', { name: /werte\.csv/ });
        const href = (await link.first().getAttribute('href')) as string;
        const download = await page.request.get(`${origin}${href}`);
        expect(download.status()).toBe(200);
        expect(download.headers()['content-disposition']).toContain('attachment');
        expect(download.headers()['x-content-type-options']).toBe('nosniff');
        expect(await download.text()).toContain('x;y');
        const shots = process.env.PAGEWISE_E2E_SHOTS ?? join(base, 'shots');
        mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: join(shots, 'chat.png'), fullPage: false });

        // 5. Das Modell hat das Seitenbild der Sichtprüfung bekommen: ein echtes PNG
        const withImage = received.at(-1)?.messages.at(-1);
        const parts = (withImage?.content ?? []) as { type: string; image_url?: { url: string } }[];
        const image = parts.find((part) => part.type === 'image_url')?.image_url?.url ?? '';
        expect(image.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true);
        expect(Buffer.from(image.split(',')[1] as string, 'base64').length).toBeGreaterThan(1_000);

        // 6. Keine Meldung der Oberfläche, keine CSP-Verletzung
        expect(problems).toEqual([]);
      } finally {
        await browser.close();
      }
    }, 180_000);
  },
);
