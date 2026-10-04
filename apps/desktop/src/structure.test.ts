import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Strukturtests am Quelltext der Hülle: Sie halten fest, was nie vorkommen darf. Die Logik dahinter prüfen die
 * Tests der einzelnen Module, hier geht es um die Verdrahtung in `main.ts`.
 */
const src = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(src, path), 'utf8');
const main = read('main.ts');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|js|html|css)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}
const all = sources(src).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
/** Quelltext ohne Kommentare: Erklärungen dürfen verbotene Wörter nennen, der Code nicht. */
const stripComments = (text: string) =>
  text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('Serverprozess: keine Secrets in Argumenten, Umgebung ist eine Allowlist', () => {
  it('startet ihn mit leerer Argumentliste und der Umgebung aus buildServerEnv', () => {
    const forks = [...main.matchAll(/utilityProcess\.fork\(([\s\S]*?)\n {2}\}\);/g)];
    expect(forks).toHaveLength(1);
    const call = forks[0]?.[1] ?? '';
    expect(call).toMatch(/pagewise-embedded\.mjs'\),\s*\[\],/);
    expect(call).toContain('env: buildServerEnv({');
    expect(call).not.toMatch(/env:\s*process\.env/);
    expect(call).not.toMatch(/\.\.\.process\.env/);
    expect(call).not.toMatch(/execArgv/);
  });

  it('gibt process.env nirgends als Ganzes weiter', () => {
    for (const { path, text } of all.filter((f) => f.path.endsWith('.ts'))) {
      expect(text, path).not.toMatch(/env:\s*process\.env\b/);
      expect(text, path).not.toMatch(/\.\.\.process\.env\b/);
    }
  });

  it('übergibt dem Server nur Port, Host, Ordner und Pfade, nie ein Secret', () => {
    const block = main.slice(main.indexOf('buildServerEnv({'), main.indexOf('serviceName'));
    expect(block).toMatch(/source: process\.env/);
    for (const key of ['port', 'host', 'serverDir', 'dataDir']) expect(block).toContain(key);
    expect(block).not.toMatch(/token|secret|password|passcode|key/i);
  });
});

describe('Keine Abkürzungen bei Berechtigungen und Code', () => {
  it('nutzt nie ein Flag, das alle Berechtigungsabfragen überspringt', () => {
    for (const { path, text } of all) {
      expect(text, path).not.toMatch(
        /dangerously-skip-permissions|dangerouslySkip|skip-permissions/i,
      );
    }
  });

  it('nutzt weder eval noch new Function noch executeJavaScript', () => {
    for (const { path, text } of all) {
      const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, path).not.toMatch(/\beval\s*\(|new Function\s*\(|executeJavaScript/);
    }
  });

  it('lockert nirgends Sicherheitsoptionen des Fensters', () => {
    for (const { path, text: raw } of all) {
      const text = stripComments(raw);
      expect(text, path).not.toMatch(
        /nodeIntegration:\s*true|contextIsolation:\s*false|sandbox:\s*false|webSecurity:\s*false|webviewTag:\s*true|allowRunningInsecureContent:\s*true|enableRemoteModule|--disable-web-security|--no-sandbox/,
      );
    }
  });

  it('öffnet extern nur geprüfte Adressen aus der Navigationsentscheidung oder feste Konstanten', () => {
    const calls = [...main.matchAll(/openExternal\(([^)]*)\)/g)].map((m) =>
      (m[1] ?? '').trim().replace(/,$/, ''),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const argument of calls) {
      expect(
        [
          'decision.url',
          'DOCS_URL',
          "'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'",
          // Die Verbindung zum Controller: Er ruft sie nur mit festen Adressen auf (siehe der nächste Test).
          'url',
        ],
        argument,
      ).toContain(argument);
    }
  });

  it('hat kein funkenfreies Telemetrie- oder Update-Ping: keine fremden Adressen im Quelltext der App', () => {
    for (const { path, text } of all.filter(
      (f) => f.path.endsWith('.ts') && !f.path.endsWith('config.ts'),
    )) {
      const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const urls = [...code.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]);
      for (const url of urls) {
        expect(
          /^https?:\/\/(127\.0\.0\.1|\$\{)/.test(url) ||
            /^https?:\/\/(example\.org|localhost)/.test(url),
          `${path}: ${url}`,
        ).toBe(true);
      }
    }
  });
});

describe('Hüllen-Seiten (eigene strenge CSP)', () => {
  const pages = all.filter((f) => f.path.endsWith('.html'));

  it('gibt es mindestens die Startseite', () => {
    expect(pages.length).toBeGreaterThanOrEqual(1);
  });

  it('haben eine CSP ohne unsafe-inline und unsafe-eval, ohne Inline-Skript und ohne style-Attribut', () => {
    for (const { path, text } of pages) {
      const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(text)?.[1] ?? '';
      expect(csp, path).toContain("default-src 'none'");
      expect(csp, path).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
      expect(csp, path).toContain("script-src 'self'");
      expect(text, path).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
      expect(text, path).not.toMatch(/\sstyle="/);
      expect(text, path).not.toMatch(/<style[\s>]/);
    }
  });

  it('setzen keine Inline-Styles und kein innerHTML in ihren Skripten', () => {
    for (const { path, text } of all.filter(
      (f) => f.path.includes('/shell/') && f.path.endsWith('.js'),
    )) {
      expect(text, path).not.toMatch(
        /\.innerHTML|insertAdjacentHTML|setAttribute\(\s*['"]style|\.cssText|document\.write/,
      );
    }
  });
});

describe('Datenschutz', () => {
  it('setzt die Chromium-Schalter gegen Hintergrundverbindungen, bevor irgendetwas anderes passiert', () => {
    const call = main.indexOf('applyPrivacySwitches(app.commandLine)');
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(main.indexOf('app.whenReady()'));
    expect(call).toBeLessThan(main.indexOf('requestSingleInstanceLock()'));
    expect(call).toBeLessThan(main.indexOf('utilityProcess.fork('));
  });
});

describe('Hauptfenster', () => {
  it('lädt nur den eigenen Server und die eigenen Hüllen-Seiten', () => {
    expect(main).toContain('routeUrl(origin(), path)');
    expect(main).toMatch(/loadFile\(join\(shellDir, 'starting\.html'\)/);
    expect(main).not.toMatch(/loadURL\(\s*['"`]https?:/);
  });

  it('schließt das Fenster nur zu (versteckt), solange nicht beendet wird', () => {
    expect(main).toMatch(
      /win\.on\('close', \(event\) => \{\s*if \(quitting\) return;\s*event\.preventDefault\(\);\s*win\.hide\(\);/,
    );
  });

  it('hält die Daten des Fensters getrennt vom Datenverzeichnis des Servers', () => {
    expect(main).toContain("app.setPath('userData', windowDataDir)");
    expect(main).toMatch(/windowDataDir = join\(dataDir, WINDOW_DATA_DIRNAME\)/);
  });

  it('nutzt die Einzelinstanz und installiert die Berechtigungsrichtlinie vor dem ersten Fenster', () => {
    expect(main).toContain('requestSingleInstanceLock()');
    expect(main.indexOf('installPermissionPolicy(session.defaultSession)')).toBeLessThan(
      main.lastIndexOf('mainWindow = createMainWindow()'),
    );
  });
});

describe('Verbindungsfenster und Preload', () => {
  const preload = read('preload.ts');

  it('legt nur feste, benannte Funktionen in die Seite, nie ein allgemeines invoke oder send', () => {
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer\s*[,)]/);
    expect(preload).not.toMatch(/:\s*ipcRenderer\b/);
    expect(preload).not.toMatch(/\binvoke:\s|\bsend:\s|\bon:\s|\bonce:\s|\bremoveListener/);
    for (const call of preload.matchAll(/ipcRenderer\.invoke\(([^)]*)\)/g)) {
      expect(call[1], call[0]).toMatch(/^\s*CHANNELS\.\w+/);
    }
  });

  it('jeder Kanal des Preloads hat einen Handler, der den Absender prüft', () => {
    const window = read('connect-window.ts');
    expect(window).toContain('isTrustedSender(event.senderFrame?.url');
    expect(window).toContain('event.sender === this.window.webContents');
    for (const channel of preload.matchAll(/CHANNELS\.(\w+)/g)) {
      const name = channel[1] ?? '';
      if (name === 'getStatus') continue;
      expect(window, name).toContain(`CHANNELS.${name}`);
    }
  });

  it('die Seite prüft den QR-Pfad mit derselben Zeichenmenge wie der Hauptprozess', async () => {
    const { QR_PATH_PATTERN } = await import('./tailscale/qr');
    const page = read('shell/connect/connect.js');
    expect(page).toContain(`const QR_PATH = ${QR_PATH_PATTERN.toString()};`);
  });

  it('die Seite baut alles mit textContent und createElement, nie aus Text mit Markup', () => {
    const page = stripComments(read('shell/connect/connect.js'));
    expect(page).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|\.style\b|setAttribute\(\s*['"]style/,
    );
    expect(page).toContain('textContent');
  });

  it('das Verbindungsfenster hat die Hüllen-Optionen mit eigenem Preload und lässt keine Navigation zu', () => {
    const window = read('connect-window.ts');
    expect(window).toContain('buildShellWindowOptions(');
    expect(window).toMatch(/will-navigate', \(event\) => event\.preventDefault\(\)/);
    expect(window).toMatch(/setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  });

  it('der Controller öffnet nur feste Adressen aus der Konfiguration, nie etwas, das die Seite schickt', () => {
    const controller = stripComments(read('connect-controller.ts'));
    const calls = [...controller.matchAll(/deps\.openExternal\(([^;]*)\);/g)].map((m) =>
      (m[1] ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const argument of calls) {
      expect(argument, argument).toMatch(
        /^(this\.deps\.urls\.\w+|kind === 'dns' \? this\.deps\.urls\.adminDns : this\.deps\.urls\.adminMachines)$/,
      );
    }
  });

  it('ruft nie tailscale funnel auf, auch nicht in Texten für Befehle', () => {
    for (const { path, text } of all.filter(
      (f) => f.path.includes('/tailscale/') && f.path.endsWith('.ts'),
    )) {
      const code = stripComments(text);
      expect(code, path).not.toMatch(/['"`]funnel['"`]/);
    }
  });
});

describe('Packen und Verteilen (Stufe 1)', () => {
  const scripts = join(src, '..', 'scripts');
  const packageScript = readFileSync(join(scripts, 'package.ts'), 'utf8');

  it('nimmt Server und Lizenzhinweise als Ressourcen mit und legt die Lizenzen von Electron in die App', () => {
    expect(packageScript).toMatch(/extraResource: \[[^\]]*'server'[^\]]*'licenses'[^\]]*\]/);
    expect(packageScript).toContain('Electron-LICENSE');
    expect(packageScript).toContain('LICENSES.chromium.html');
  });

  it('hat deutsche Texte für die Zugriffsfragen von macOS (die App lehnt sie ohnehin ab)', () => {
    expect(packageScript).toMatch(
      /usageDescription: \{[^}]*Camera: 'Pagewise nutzt die Kamera nicht\.'/,
    );
    expect(stripComments(packageScript)).not.toContain('This app needs');
  });

  it('signiert in Stufe 1 nur ad hoc: keine Zugangsdaten, keine Identität, kein Flag, das Abfragen überspringt', () => {
    const code = stripComments(packageScript);
    expect(code).toContain("'--sign', '-'");
    expect(code).not.toMatch(/osxSign\s*:|osxNotarize\s*:/);
    expect(code).not.toMatch(/process\.env\.(APPLE|CSC|NOTARY)/);
    expect(code).not.toMatch(/dangerously|skip-permissions/);
  });
});
