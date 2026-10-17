import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { messages as m } from './i18n';
import { CHANNELS, isTrustedSender } from './ipc';
import type { UpdateController } from './update/controller';
import { buildShellWindowOptions } from './window-options';

/** Ordner der Seiten des Update-Fensters (nur von hier nimmt der Hauptprozess Anfragen an). */
export function updateWindowDir(shellDir: string): string {
  return join(shellDir, 'update');
}

/**
 * Das kleine Hüllen-Fenster „Nach Updates suchen“: lokale Seite mit eigener CSP und dem Preload der Hülle. Wie beim
 * Verbindungsfenster nimmt der Hauptprozess nur Anfragen genau dieses Fensters und dieser Seite an, und die Seite
 * kann keine Adresse, keinen Befehl und keinen Pfad vorgeben: Sie sagt nur „prüfen“, „vorbereiten“, „abbrechen“,
 * „neu starten“.
 *
 * Lange Aufgaben (Nachsehen, Vorbereiten, Neustart) laufen im Controller weiter; die Seite fragt den Stand ab.
 */
export class UpdateWindow {
  private window: BrowserWindow | null = null;
  private registered = false;

  constructor(
    private readonly controller: UpdateController,
    private readonly paths: { shellDir: string; preload: string },
    private readonly parent: () => BrowserWindow | null,
  ) {}

  /** Das Fenster, über dem Dialoge erscheinen sollen (solange es offen ist). */
  parentWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  private get dirUrl(): string {
    return pathToFileURL(updateWindowDir(this.paths.shellDir)).href;
  }

  private trusted(event: Electron.IpcMainInvokeEvent): boolean {
    return (
      this.window !== null &&
      !this.window.isDestroyed() &&
      event.sender === this.window.webContents &&
      isTrustedSender(event.senderFrame?.url, this.dirUrl)
    );
  }

  /** Registriert die Kanäle (einmal). Jeder prüft den Absender, bevor er etwas tut. */
  registerIpc(): void {
    if (this.registered) return;
    this.registered = true;
    const handle = <Args extends unknown[]>(
      channel: string,
      work: (...args: Args) => unknown,
    ): void => {
      ipcMain.handle(channel, (event, ...args) => {
        if (!this.trusted(event)) throw new Error('Nicht erlaubt.');
        return work(...(args as Args));
      });
    };
    // Die Aufgaben laufen weiter, der Aufruf kehrt sofort mit dem neuen Stand zurück.
    const background = (task: Promise<unknown>): void => {
      task.catch(() => undefined);
    };
    handle(CHANNELS.getUpdateView, () => this.controller.getView());
    handle(CHANNELS.checkUpdate, () => {
      background(this.controller.check('manual'));
      return this.controller.getView();
    });
    handle(CHANNELS.startUpdate, () => {
      background(this.controller.start());
      return this.controller.getView();
    });
    handle(CHANNELS.cancelUpdate, () => this.controller.cancel());
    handle(CHANNELS.restartForUpdate, () => {
      background(this.controller.restart());
      return this.controller.getView();
    });
    handle(CHANNELS.setUpdateAutoCheck, (enabled: unknown) =>
      this.controller.setAutoCheck(enabled === true),
    );
    handle(CHANNELS.showUpdateLog, () => {
      this.controller.showLog();
    });
  }

  show(): void {
    this.registerIpc();
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore();
      this.window.show();
      this.window.focus();
      return;
    }
    const parent = this.parent();
    const win = new BrowserWindow(
      buildShellWindowOptions({
        preload: this.paths.preload,
        title: m.update.windowTitle,
        dark: nativeTheme.shouldUseDarkColors,
        parent: parent && !parent.isDestroyed() && parent.isVisible() ? parent : undefined,
      }),
    );
    this.window = win;
    win.removeMenu();
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      if (this.window === win) this.window = null;
    });
    // Nie wegnavigieren und nie neue Fenster öffnen: die Seite ist fest.
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.on('will-attach-webview', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    void win.loadFile(join(updateWindowDir(this.paths.shellDir), 'update.html'));
  }
}
