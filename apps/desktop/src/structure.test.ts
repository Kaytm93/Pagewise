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
const build = read(join('..', 'scripts', 'build.ts'));

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

  it('die Startseite bekommt ihr Skript gebündelt und liest die Texte nur aus i18n.ts', () => {
    expect(build).toContain("starting: join(root, 'src', 'starting.ts')");
    expect(build).toMatch(
      /renameSync\(join\(dist, 'starting\.cjs'\), join\(dist, 'shell', 'starting\.js'\)\)/,
    );
    const script = read('starting.ts');
    const texts = read('i18n.ts');
    expect(script).toContain("from './i18n'");
    // Auswahl der Stufen, ohne die Texte zu wiederholen:
    expect(script).toMatch(/state === 'starting'|state === 'stopped'|state === 'failed'/);
    for (const text of [
      'Pagewise startet',
      'Pagewise startet neu',
      'Pagewise ist ausgeschaltet',
      'Pagewise läuft nicht',
      'Der Server konnte nicht gestartet werden.',
    ]) {
      expect(script, text).not.toContain(text);
      expect(texts, text).toContain(text);
    }
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
    const windows = [read('connect-window.ts'), read('update-window.ts')];
    for (const window of windows) {
      expect(window).toContain('isTrustedSender(event.senderFrame?.url');
      expect(window).toContain('event.sender === this.window.webContents');
    }
    for (const channel of preload.matchAll(/CHANNELS\.(\w+)/g)) {
      const name = channel[1] ?? '';
      if (name === 'getStatus') continue;
      expect(
        windows.some((window) => window.includes(`CHANNELS.${name}`)),
        name,
      ).toBe(true);
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

  it('baut nur bei echten Änderungen neu und holt Fokus und getippten Namen zurück', () => {
    const page = read('shell/connect/connect.js');
    // Kein erzwungener Baumtausch mehr: Aktion und Refresh gehen durch denselben Abgleich.
    expect(page).toContain('function render(view)');
    expect(page).not.toMatch(/render\([^)]*,\s*(?:true|force)\s*\)/);
    // Fokus-Marke sichern und nach dem Einhängen zurückholen (erst der eingehängte Knoten ist fokussierbar).
    expect(page).toContain('focusKey(document.activeElement)');
    const mount = page.indexOf('root.replaceChildren');
    const restore = page.indexOf('?.focus()');
    expect(mount).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(mount);
    // Getippter Text überlebt den Neubau: gespeichert und statt des Vorschlags eingesetzt.
    expect(page).toContain('typed.value');
    expect(page).toContain('setSelectionRange');
  });

  it('nur die Statuszeile meldet sich: der Seitencontainer trägt kein aria-live', () => {
    const page = read('shell/connect/connect.html');
    expect(page).toContain('<main id="app">');
    expect(page).not.toMatch(/<main[^>]*aria-live/);
    const script = stripComments(read('shell/connect/connect.js'));
    expect(script).toMatch(/setAttribute\(\s*['"]role['"],\s*['"]status['"]\s*\)/);
    expect(script).toMatch(/setAttribute\(\s*['"]aria-live['"],\s*['"]polite['"]\s*\)/);
  });

  it('Knöpfe und Eingabe des Verbindungsfensters sind mindestens 44 px hoch', () => {
    const css = read('shell/connect/connect.css');
    for (const selector of ['button {', 'input {']) {
      const block = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)));
      expect(block, selector).toMatch(/min-height:\s*(4[4-9]|[5-9]\d|1\d{2,})px/);
    }
    expect(css).not.toMatch(/min-height:\s*36px/);
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

describe('Updates (D-057)', () => {
  const updateSources = all.filter(
    (f) =>
      /[\\/]update[\\/]/.test(f.path) &&
      f.path.endsWith('.ts') &&
      !f.path.endsWith('test-support.ts'),
  );
  const page = read('shell/update/update.js');
  const pageHtml = read('shell/update/update.html');
  const css = read('shell/update/update.css');
  const updateWindow = read('update-window.ts');

  it('führt Programme nie über eine Shell aus und baut keine Befehle aus Text', () => {
    expect(updateSources.length).toBeGreaterThan(0);
    for (const { path, text } of [
      ...updateSources,
      { path: 'update-window.ts', text: updateWindow },
    ]) {
      const code = stripComments(text);
      expect(code, path).not.toMatch(
        /shell:\s*true|(?<![.\w])exec\(|execSync\(|execFileSync\(|spawnSync\(/,
      );
      expect(code, path).not.toMatch(/['"`](?:\/bin\/)?(?:ba|z)?sh['"`]/);
      expect(code, path).not.toMatch(/\bsh -c|bash -c|zsh -c|-ilc/);
    }
    // Der einzige `spawn` der App für den Helfer: Argumentliste, losgelöst, ohne Ausgabe, mit eigener Umgebung.
    const spawns = [
      ...stripComments(main).matchAll(/spawn\(spec\.command, spec\.args, \{([\s\S]*?)\}\)/g),
    ];
    expect(spawns).toHaveLength(1);
    const options = spawns[0]?.[1] ?? '';
    expect(options).toContain('env: spec.env');
    expect(options).toContain('detached: true');
    expect(options).toContain("stdio: 'ignore'");
    expect(options).not.toContain('shell');
  });

  it('nennt die Quelle nur über die Konstanten aus config.ts, nirgends sonst eine Adresse', () => {
    const config = read('config.ts');
    expect(config).toContain("UPDATE_REPO_URL = 'https://github.com/Kaytm93/Pagewise.git'");
    expect(config).toContain("UPDATE_BRANCH = 'main'");
    expect(stripComments(main)).toMatch(/repoUrl: UPDATE_REPO_URL,\s*branch: UPDATE_BRANCH,/);
    for (const { path, text } of updateSources) {
      expect(stripComments(text), path).not.toMatch(/https?:\/\/(?!example\.org)/);
    }
  });

  it('gibt den Update-Programmen nie die ganze Umgebung der App', () => {
    for (const { path, text } of updateSources) {
      expect(stripComments(text), path).not.toMatch(/process\.env/);
    }
    expect(stripComments(main)).toMatch(/source: process\.env,\s*home: app\.getPath\('home'\)/);
  });

  it('läuft nur auf Klick: Auch das Nachsehen beim Start hängt an einer Einstellung, die aus ist', () => {
    const settings = read('settings-store.ts');
    expect(settings).toMatch(/checkUpdatesOnStart: false/);
    const body = main.slice(main.indexOf('async function autoCheckForUpdates'));
    expect(body.slice(0, 200)).toContain('checkUpdatesOnStart');
    // Installiert wird nur über `restart` nach Rückfrage, nie aus dem Nachsehen heraus.
    const controller = read('update/controller.ts');
    const check = controller.slice(
      controller.indexOf('async check('),
      controller.indexOf('private applyCheck'),
    );
    expect(check).not.toMatch(/prepare|handoff|spawnDetached|quit\(/);
  });

  it('fragt vor dem Neustart nach und beendet die App erst nach dem Start des Helfers', () => {
    const controller = stripComments(read('update/controller.ts'));
    const restart = controller.slice(
      controller.indexOf('async restart('),
      controller.indexOf('// --- Sonstiges'),
    );
    const confirm = restart.indexOf('confirmRestart');
    const handoff = restart.indexOf('handoff(');
    const spawn = restart.indexOf('spawnDetached');
    const quit = restart.indexOf('this.deps.quit()');
    expect(confirm).toBeGreaterThan(-1);
    expect(confirm).toBeLessThan(handoff);
    expect(handoff).toBeLessThan(spawn);
    expect(spawn).toBeLessThan(quit);
  });

  it('die Seite baut alles mit textContent und createElement, nie aus Text mit Markup', () => {
    const code = stripComments(page);
    expect(code).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|\.style\b|setAttribute\(\s*['"]style|\.cssText/,
    );
    expect(code).toContain('textContent');
    expect(code).toContain('replaceChildren');
  });

  it('die Seite hat eine strenge CSP, kein Inline-Skript und keine Inline-Styles', () => {
    const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(pageHtml)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    expect(pageHtml).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>|\sstyle="|<style[\s>]/);
  });

  it('nur die Statuszeile meldet sich, der Seitencontainer nicht', () => {
    expect(pageHtml).not.toMatch(/<main[^>]*aria-live/);
    expect(stripComments(page)).toMatch(
      /setAttribute\(\s*['"]aria-live['"],\s*['"]polite['"]\s*\)/,
    );
  });

  it('Knöpfe und Kästchen sind groß genug (44 px, Kästchen 24 px)', () => {
    const block = (selector: string) =>
      css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)));
    expect(block('button {')).toMatch(/min-height:\s*(4[4-9]|[5-9]\d|1\d{2,})px/);
    expect(block('.option {')).toMatch(/min-height:\s*(4[4-9]|[5-9]\d|1\d{2,})px/);
    expect(block('.option input {')).toMatch(/width:\s*24px/);
  });

  it('das Fenster hat die Hüllen-Optionen und lässt keine Navigation zu', () => {
    expect(updateWindow).toContain('buildShellWindowOptions(');
    expect(updateWindow).toMatch(/will-navigate', \(event\) => event\.preventDefault\(\)/);
    expect(updateWindow).toMatch(/setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  });

  it('die Seite kann nichts vorgeben: Der Preload reicht nur einen Wahrheitswert weiter', () => {
    const preload = read('preload.ts');
    for (const fn of [
      'checkUpdate',
      'startUpdate',
      'cancelUpdate',
      'restartForUpdate',
      'showUpdateLog',
    ]) {
      expect(preload, fn).toMatch(new RegExp(`${fn}: \\(\\): Promise<unknown> =>`));
    }
    expect(preload).toMatch(/setUpdateAutoCheck: \(enabled: boolean\)/);
    expect(updateWindow).toContain('enabled === true');
  });

  it('der Helfer wird aus dem Arbeitsordner gestartet, nicht aus der App, die er ersetzt', () => {
    const service = read('update/service.ts');
    expect(service).toContain("join(paths.repo, 'scripts', 'apply-update.mjs')");
  });

  it('der Knopf der Oberfläche und die Hülle meinen dieselbe Adresse und die Hülle fängt sie ab', () => {
    const web = readFileSync(join(src, '..', '..', 'web', 'src', 'ui', 'desktop-app.ts'), 'utf8');
    const path = /DESKTOP_UPDATE_PATH = '([^']+)'/.exec(web)?.[1];
    expect(path).toBe('/__pagewise/update');
    expect(read('config.ts')).toContain(`UPDATE_PATH = '${path}'`);
    const code = stripComments(main);
    expect(code).toMatch(/decision\.action === 'update'\) showUpdates\(\)/g);
    expect([...code.matchAll(/decision\.action === 'update'/g)]).toHaveLength(2);
  });
});
