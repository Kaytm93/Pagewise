import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  Notification,
  nativeImage,
  nativeTheme,
  powerSaveBlocker,
  screen,
  session,
  shell,
  Tray,
  utilityProcess,
} from 'electron';
import {
  APP_NAME,
  DOCS_URL,
  ROUTES,
  SERVER_HOST,
  SERVER_PORT,
  TAILSCALE_ADMIN_DNS_URL,
  TAILSCALE_ADMIN_MACHINES_URL,
  TAILSCALE_APP_PATH,
  TAILSCALE_DOWNLOAD_URL,
  WINDOW_DATA_DIRNAME,
} from './config';
import { ConnectController } from './connect-controller';
import { ConnectWindow, connectWindowDir } from './connect-window';
import { uniqueDownloadPath } from './downloads';
import { ERASE_DATA_TYPES, ERASE_PATH, isEraseSuccess } from './erase-hook';
import { messages as m } from './i18n';
import { CHANNELS, isTrustedSender } from './ipc';
import { KeepAwake } from './keep-awake';
import { type LoginItemApi, readLoginItem, setOpenAtLogin, shouldStartHidden } from './login-item';
import { buildMenuTemplate, type MenuActions } from './menu';
import { decideNavigation, decideWindowOpen, routeUrl } from './navigation';
import { installPermissionPolicy } from './permissions';
import { applyPrivacySwitches } from './privacy';
import { describeQuit } from './quit-guard';
import { buildServerEnv } from './server-env';
import { fitBounds, SettingsStore, ZOOM_MAX, ZOOM_MIN } from './settings-store';
import { buildDesktopStatus, type DesktopStatus } from './status';
import { type ChildHandle, ServerSupervisor } from './supervisor';
import { realExec } from './tailscale/cli';
import type { Inspection } from './tailscale/service';
import { TailscaleService } from './tailscale/service';
import { buildTrayMenuTemplate } from './tray-menu';
import { buildWindowOptions } from './window-options';

// Hauptprozess der Mac-App. Die Logik steckt in kleinen, einzeln getesteten Modulen; diese Datei verdrahtet sie
// mit Electron. Sicherheit des Fensters: siehe `window-options.ts`, `navigation.ts`, `permissions.ts` (D-050).

// Keine Verbindung zu Fremden von sich aus: vor allem anderen, noch vor `ready` (siehe `privacy.ts`).
applyPrivacySwitches(app.commandLine);

// Auf dem Mac prüft macOS die Rechtschreibung selbst. Anderswo lädt Chromium dafür ein Wörterbuch von Google
// (`redirector.gvt1.com`, im Netzprotokoll gemessen): kein Hintergrundverkehr, also aus, sobald eine Sitzung entsteht.
app.on('session-created', (created) => {
  if (process.platform !== 'darwin') created.setSpellCheckerEnabled(false);
});

const smokeTest = process.argv.includes('--smoke-test');
const dataDirOverride = process.env.PAGEWISE_DATA_DIR?.trim() || null;

/** Ordner des Servers im gebauten Stand (`Resources/server` in der App, `dist/server` in der Entwicklung). */
const serverDir = app.isPackaged
  ? join(process.resourcesPath, 'server')
  : join(__dirname, 'server');
const shellDir = join(__dirname, 'shell');

let smokeDir: string | null = null;
let serverPort = SERVER_PORT;
let dataDir: string;

if (smokeTest) {
  // Der Rauchtest rührt weder Daten noch Einstellungen des Menschen an: eigener Ordner, freier Port.
  smokeDir = mkdtempSync(join(tmpdir(), 'pagewise-smoke-'));
  dataDir = join(smokeDir, 'daten');
} else {
  dataDir = dataDirOverride ?? join(app.getPath('appData'), APP_NAME);
}
// Chromium-Daten (Cookies, Speicher, Cache, Service Worker) in einen eigenen Unterordner, getrennt vom Server.
const windowDataDir = join(dataDir, WINDOW_DATA_DIRNAME);
mkdirSync(windowDataDir, { recursive: true, mode: 0o700 });
app.setPath('userData', windowDataDir);
app.setName(APP_NAME);
// Der Sandkasten der Renderer ist je Fenster festgenagelt (`window-options.ts`); `app.enableSandbox()` ist damit
// überflüssig und würde das Testen als Root im Container (`--no-sandbox` für alle Prozesse) verhindern.

const origin = (): string => `http://${SERVER_HOST}:${serverPort}`;

// --- Server ---------------------------------------------------------------------------------------

function spawnServer(): ChildHandle {
  const child = utilityProcess.fork(join(serverDir, 'pagewise-embedded.mjs'), [], {
    // Keine Argumente, nichts Geheimes in der Prozessliste. Die Umgebung ist eine Allowlist.
    env: buildServerEnv({
      source: process.env,
      port: serverPort,
      host: SERVER_HOST,
      serverDir,
      dataDir: smokeDir ? dataDir : dataDirOverride,
    }),
    serviceName: 'Pagewise Server',
    stdio: app.isPackaged ? 'ignore' : 'inherit',
  });
  return {
    postMessage: (message) => child.postMessage(message),
    kill: () => child.kill(),
    onMessage: (handler) => {
      child.on('message', handler);
    },
    onExit: (handler) => {
      child.on('exit', (code) => handler(code));
    },
  };
}

async function probeHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${origin()}/api/health`, { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: unknown };
    return body.status === 'ok';
  } catch {
    return false;
  }
}

const supervisor = new ServerSupervisor({ spawn: spawnServer, probe: probeHealth });

// --- Zustand --------------------------------------------------------------------------------------

const store = new SettingsStore(join(windowDataDir, 'desktop-settings.json'));
const keepAwake = new KeepAwake(powerSaveBlocker);
let lastServerStatus: { activeChats: number; sessions: number; setupPending: boolean } | null =
  null;
/** Tailscale-Zustand und Adresse (wird mit M3 ermittelt, bis dahin leer). */
const tailscale: { view: { state: string; address: string | null } | null } = { view: null };
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let stopped = false;
let setupCodeShown = false;

const loginApi: LoginItemApi = {
  getLoginItemSettings: () => app.getLoginItemSettings(),
  setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
};

function currentStatus(): DesktopStatus {
  return buildDesktopStatus({
    server: supervisor.getSnapshot(),
    serverStatus: lastServerStatus,
    keepAwake: {
      enabled: store.read().keepAwake,
      active: keepAwake.active,
      reason: keepAwake.reason,
    },
    loginItem: readLoginItem(loginApi, process.platform),
    tailscale: tailscale.view,
  });
}

async function refreshServerStatus(): Promise<void> {
  lastServerStatus =
    supervisor.getSnapshot().state === 'running' ? await supervisor.serverStatus() : null;
  keepAwake.update({
    userEnabled: store.read().keepAwake,
    activeChats: lastServerStatus?.activeChats ?? 0,
  });
  rebuildMenus();
}

// --- Fenster --------------------------------------------------------------------------------------

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function loadStartingPage(win: BrowserWindow): void {
  const snapshot = supervisor.getSnapshot();
  void win.loadFile(join(shellDir, 'starting.html'), {
    query: {
      state: snapshot.state,
      message: snapshot.failure?.message.split('\n')[0] ?? '',
    },
  });
}

function loadApp(win: BrowserWindow, path: string = ROUTES.home): void {
  void win.loadURL(routeUrl(origin(), path));
}

function createMainWindow(): BrowserWindow {
  const settings = store.read();
  const win = new BrowserWindow(
    buildWindowOptions({
      bounds: fitBounds(
        settings.windowBounds,
        screen.getAllDisplays().map((display) => display.bounds),
      ),
      dark: nativeTheme.shouldUseDarkColors,
    }),
  );
  const contents = win.webContents;

  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });

  // Fenster schließen versteckt nur: Der Server läuft weiter (iPhone und iPad brauchen ihn).
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const saveBounds = (): void => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win.isDestroyed() || win.isMaximized() || win.isFullScreen() || win.isMinimized()) return;
      store.update({ windowBounds: win.getBounds() });
    }, 400);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  contents.on('dom-ready', () => contents.setZoomLevel(store.read().zoomLevel));
  contents.on('will-attach-webview', (event) => event.preventDefault());

  // Navigation nur zur eigenen Herkunft, fremdes http(s) im Standardbrowser.
  const guard = (event: { preventDefault(): void }, url: string): void => {
    if (url.startsWith(pathToFileURL(shellDir).href)) return;
    const decision = decideNavigation(url, origin());
    if (decision.action === 'allow') return;
    event.preventDefault();
    if (decision.action === 'external') void shell.openExternal(decision.url);
  };
  contents.on('will-navigate', (event) => guard(event, event.url));
  contents.on('will-redirect', (event) => guard(event, event.url));

  contents.setWindowOpenHandler(({ url }) => {
    const decision = decideWindowOpen(url, origin());
    if (decision.action === 'external') void shell.openExternal(decision.url);
    else if (decision.action === 'download') contents.downloadURL(decision.url);
    else if (decision.action === 'navigate') void win.loadURL(decision.url);
    return { action: 'deny' };
  });

  // Der Server war weg (Neustart, Absturz): sobald er wieder läuft, lädt das Fenster neu.
  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3 && supervisor.getSnapshot().state !== 'running') {
      loadStartingPage(win);
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (supervisor.getSnapshot().state === 'running') loadApp(win);
  else loadStartingPage(win);
  return win;
}

// --- Aktionen -------------------------------------------------------------------------------------

function navigate(path: string): void {
  showWindow();
  if (mainWindow) loadApp(mainWindow, path);
}

function changeZoom(delta: number | 'reset'): void {
  if (!mainWindow) return;
  const level =
    delta === 'reset'
      ? 0
      : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, mainWindow.webContents.getZoomLevel() + delta));
  mainWindow.webContents.setZoomLevel(level);
  store.update({ zoomLevel: level });
}

async function showSetupCode(): Promise<void> {
  const code = await supervisor.setupCode();
  showWindow();
  if (!code) {
    await dialog.showMessageBox({
      type: 'info',
      message: m.dialogs.setupCodeTitle,
      detail: m.dialogs.setupCodeNone,
      buttons: [m.dialogs.ok],
    });
    return;
  }
  const result = await dialog.showMessageBox({
    type: 'info',
    message: `${m.dialogs.setupCodeTitle}: ${code}`,
    detail: m.dialogs.setupCodeBody,
    buttons: [m.dialogs.copy, m.dialogs.ok],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response === 0) clipboard.writeText(code);
}

async function resetPasscode(): Promise<void> {
  showWindow();
  const confirm = await dialog.showMessageBox({
    type: 'warning',
    message: m.dialogs.resetTitle,
    detail: m.dialogs.resetDetail,
    buttons: [m.dialogs.resetConfirm, m.dialogs.cancel],
    defaultId: 1,
    cancelId: 1,
  });
  if (confirm.response !== 0) return;
  if (await supervisor.resetPasscode()) {
    setupCodeShown = false;
    await refreshServerStatus();
    if (mainWindow) loadApp(mainWindow);
    await showSetupCode();
  } else {
    dialog.showErrorBox(m.dialogs.resetTitle, m.dialogs.resetFailed);
  }
}

async function confirmQuit(): Promise<void> {
  const status =
    supervisor.getSnapshot().state === 'running' ? await supervisor.serverStatus() : null;
  const { needsConfirm, detail } = describeQuit(status);
  if (needsConfirm) {
    showWindow();
    const result = await dialog.showMessageBox({
      type: 'warning',
      message: m.dialogs.quitTitle,
      detail,
      buttons: [m.dialogs.quitConfirm, m.dialogs.cancel],
      defaultId: 1,
      cancelId: 1,
    });
    if (result.response !== 0) return;
  }
  quitting = true;
  app.quit();
}

function setKeepAwake(enabled: boolean): void {
  store.update({ keepAwake: enabled });
  void refreshServerStatus();
}

function changeOpenAtLogin(enabled: boolean): void {
  const state = setOpenAtLogin(loginApi, enabled, process.platform);
  rebuildMenus();
  if (state.needsApproval) {
    void dialog
      .showMessageBox({
        type: 'info',
        message: m.dialogs.loginApprovalTitle,
        detail: m.dialogs.loginApprovalDetail,
        buttons: [m.dialogs.openSystemSettings, m.dialogs.ok],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        // Apple-Adresse der Systemeinstellungen für Anmeldeobjekte (nicht verifiziert, nur auf dem Mac prüfbar).
        if (result.response === 0) {
          void shell.openExternal(
            'x-apple.systempreferences:com.apple.LoginItems-Settings.extension',
          );
        }
      });
  }
}

// --- Tailscale und „Mit iPhone und iPad verbinden“ ---------------------------------------------------

const tailscaleService = new TailscaleService({ exec: realExec(), localPort: SERVER_PORT });
let funnelWarned = false;
let lastEnsure = 0;

function rememberInspection(inspection: Inspection): void {
  const next = { state: inspection.state, address: inspection.address };
  if (tailscale.view?.state === next.state && tailscale.view.address === next.address) return;
  tailscale.view = next;
  rebuildMenus();
}

const connectController = new ConnectController({
  tailscale: tailscaleService,
  confirm: async ({ title, detail, confirmLabel }) => {
    const parent = connectWindow.parentWindow();
    const options = {
      type: 'warning' as const,
      message: title,
      detail,
      buttons: [confirmLabel, m.dialogs.cancel],
      defaultId: 1,
      cancelId: 1,
    };
    const result = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    return result.response === 0;
  },
  copy: (text) => clipboard.writeText(text),
  openExternal: (url) => void shell.openExternal(url),
  openPath: (path) => void shell.openPath(path),
  keepAwake: () => store.read().keepAwake,
  rememberServe: (enabled) => {
    store.update({ tailscaleServe: enabled });
  },
  changed: rememberInspection,
  urls: {
    download: TAILSCALE_DOWNLOAD_URL,
    adminDns: TAILSCALE_ADMIN_DNS_URL,
    adminMachines: TAILSCALE_ADMIN_MACHINES_URL,
    appPath: TAILSCALE_APP_PATH,
  },
});

const connectWindow = new ConnectWindow(
  connectController,
  { shellDir, preload: join(__dirname, 'preload.cjs') },
  () => mainWindow,
);

/**
 * Liest den Zustand von Tailscale (für das Menüleisten-Symbol), warnt einmal pro Start, wenn Funnel an ist, und stellt
 * eine früher von der App eingerichtete Freigabe wieder her (idempotent). Eine Freigabe, die die Person nie eingerichtet
 * hat, fasst die App nicht an, eine fremde nie.
 */
async function refreshTailscale(): Promise<void> {
  if (smokeTest) return;
  let inspection = await tailscaleService.inspect();
  const wanted = store.read().tailscaleServe;
  const retryAfterMs = 5 * 60_000;
  if (
    wanted &&
    inspection.state === 'running' &&
    !inspection.serve?.ours &&
    !inspection.hostnamePersonal &&
    inspection.proposedPort !== null &&
    Date.now() - lastEnsure > retryAfterMs
  ) {
    lastEnsure = Date.now();
    const outcome = await tailscaleService.setupServe();
    if (outcome.ok) inspection = outcome.inspection;
  }
  rememberInspection(inspection);
  if (inspection.funnel && !funnelWarned) {
    funnelWarned = true;
    const result = await dialog.showMessageBox({
      type: 'warning',
      message: m.connect.funnelDialog.title,
      detail: m.connect.funnelDialog.detail,
      buttons: [m.connect.funnelDialog.reset, m.connect.funnelDialog.ignore],
      defaultId: 1,
      cancelId: 1,
    });
    if (result.response === 0) {
      const outcome = await tailscaleService.resetServe();
      if (outcome.ok) {
        store.update({ tailscaleServe: false });
        rememberInspection(outcome.inspection);
      }
    }
  }
}

const actions: MenuActions & { copyAddress(): void; openWindow(): void } = {
  newChat: () => navigate(ROUTES.newChat),
  openSettings: () => navigate(ROUTES.settings),
  print: () => mainWindow?.webContents.print(),
  reload: () => mainWindow?.webContents.reload(),
  zoomIn: () => changeZoom(0.5),
  zoomOut: () => changeZoom(-0.5),
  resetZoom: () => changeZoom('reset'),
  closeWindow: () => mainWindow?.hide(),
  showConnect: () => connectWindow.show(),
  showSetupCode: () => void showSetupCode(),
  setKeepAwake,
  setOpenAtLogin: changeOpenAtLogin,
  resetPasscode: () => void resetPasscode(),
  openDocs: () => void shell.openExternal(DOCS_URL),
  restartServer: () => void supervisor.restart(),
  quit: () => void confirmQuit(),
  copyAddress: () => {
    if (tailscale.view?.address) clipboard.writeText(tailscale.view.address);
  },
  openWindow: () => showWindow(),
};

function rebuildMenus(): void {
  const settings = store.read();
  const login = readLoginItem(loginApi, process.platform);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate(actions, {
        keepAwake: settings.keepAwake,
        openAtLogin: login.enabled,
        loginSupported: login.supported,
        setupPending: lastServerStatus?.setupPending ?? false,
      }),
    ),
  );
  tray?.setContextMenu(
    Menu.buildFromTemplate(
      buildTrayMenuTemplate(actions, {
        server: supervisor.getSnapshot(),
        keepAwake: settings.keepAwake,
        address: tailscale.view?.address ?? null,
      }),
    ),
  );
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip(m.tray.tooltip);
  rebuildMenus();
}

// --- IPC mit Hüllen-Fenstern ----------------------------------------------------------------------

import { ipcMain } from 'electron';

ipcMain.handle(CHANNELS.getStatus, (event) => {
  // Nur unsere eigenen lokalen Seiten, nie der Inhalt des Servers.
  if (!isTrustedSender(event.senderFrame?.url, pathToFileURL(connectWindowDir(shellDir)).href)) {
    throw new Error('Nicht erlaubt.');
  }
  return currentStatus();
});

// --- Downloads und „Alles löschen“ ---------------------------------------------------------------

function installDownloads(): void {
  session.defaultSession.on('will-download', (_event, item) => {
    const path = uniqueDownloadPath(app.getPath('downloads'), item.getFilename(), existsSync);
    item.setSavePath(path);
    item.once('done', (_e, state) => {
      if (state !== 'completed') return;
      const note = new Notification({
        title: m.dialogs.downloadDone,
        body: `${path.split('/').pop() ?? ''}\n${m.dialogs.showInFinder}`,
      });
      note.on('click', () => shell.showItemInFolder(path));
      note.show();
    });
  });
}

/** „Alles löschen“ leert auch die Daten des Fensters (Speicher, Cache, Service Worker). Die Anmeldung bleibt wie im Server (D-032). */
function installEraseHook(): void {
  session.defaultSession.webRequest.onCompleted(
    { urls: [`${origin()}${ERASE_PATH}`] },
    (details) => {
      if (!isEraseSuccess(details, origin())) return;
      void session.defaultSession.clearData({ dataTypes: [...ERASE_DATA_TYPES] }).finally(() => {
        if (mainWindow) loadApp(mainWindow);
      });
    },
  );
}

// --- Start ---------------------------------------------------------------------------------------

let startHidden = false;

async function smoke(): Promise<void> {
  let ok = false;
  let reason = 'unbekannt';
  try {
    serverPort = await freePort();
    supervisor.start();
    const deadline = Date.now() + 40_000;
    while (supervisor.getSnapshot().state !== 'running') {
      if (supervisor.getSnapshot().state === 'failed' || Date.now() > deadline) {
        throw new Error(
          supervisor.getSnapshot().failure?.message.split('\n')[0] ??
            'Der Server meldet sich nicht.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!(await probeHealth())) throw new Error('/api/health antwortet nicht.');
    const status = await supervisor.serverStatus();
    if (!status) throw new Error('Der Steuerkanal (IPC) antwortet nicht.');
    const page = await fetch(`${origin()}/`);
    if (!page.ok || !(await page.text()).toLowerCase().includes('pagewise')) {
      throw new Error('Die Oberfläche wird nicht ausgeliefert.');
    }
    ok = true;
    reason = 'ok';
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  await supervisor.stop();
  if (smokeDir) rmSync(smokeDir, { recursive: true, force: true });
  process.stdout.write(`${ok ? 'Rauchtest bestanden' : `Rauchtest fehlgeschlagen: ${reason}`}\n`);
  app.exit(ok ? 0 : 1);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, SERVER_HOST, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

if (smokeTest) {
  void app.whenReady().then(smoke);
} else if (!app.requestSingleInstanceLock()) {
  // Ein zweiter Start holt das vorhandene Fenster nach vorn (siehe `second-instance`).
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.on('activate', () => showWindow());
  // Alle Fenster zu: die App läuft weiter, der Server wird gebraucht.
  app.on('window-all-closed', () => {});

  app.on('before-quit', (event) => {
    if (!quitting) {
      event.preventDefault();
      void confirmQuit();
    }
  });
  app.on('will-quit', (event) => {
    if (stopped) return;
    event.preventDefault();
    keepAwake.dispose();
    void supervisor.stop().finally(() => {
      stopped = true;
      app.quit();
    });
  });

  void app.whenReady().then(async () => {
    installPermissionPolicy(session.defaultSession);
    installDownloads();
    installEraseHook();

    startHidden = shouldStartHidden(readLoginItem(loginApi, process.platform), process.argv);
    createTray();
    supervisor.onChange((snapshot) => {
      rebuildMenus();
      if (snapshot.state === 'running') {
        void refreshServerStatus().then(() => {
          if (mainWindow && !mainWindow.isDestroyed()) loadApp(mainWindow);
          if (!setupCodeShown && lastServerStatus?.setupPending && !startHidden) {
            setupCodeShown = true;
            void showSetupCode();
          }
        });
      } else if (snapshot.state === 'failed') {
        lastServerStatus = null;
        keepAwake.update({ userEnabled: store.read().keepAwake, activeChats: 0 });
        if (mainWindow && !mainWindow.isDestroyed()) loadStartingPage(mainWindow);
        dialog.showErrorBox(
          m.dialogs.startFailedTitle,
          snapshot.failure?.message ?? m.failures.unexpected,
        );
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        // 'starting', 'restarting', 'stopped': die Startseite wählt den Text nach dem Zustand (`starting.ts`).
        loadStartingPage(mainWindow);
      }
    });
    supervisor.start();
    mainWindow = createMainWindow();
    rebuildMenus();
    void refreshTailscale();
    setInterval(() => void refreshTailscale(), 60_000).unref();
    // Laufende Antworten halten den Mac wach, auch bei ausgeschaltetem Schalter.
    setInterval(() => void refreshServerStatus(), 5_000).unref();
  });
}
