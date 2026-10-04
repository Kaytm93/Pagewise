import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, ipcMain, nativeTheme } from 'electron';
import type { ConnectController } from './connect-controller';
import { messages as m } from './i18n';
import { CHANNELS, isTrustedSender } from './ipc';
import { buildShellWindowOptions } from './window-options';

/** Ordner der Seiten des Verbindungsfensters (nur von hier nimmt der Hauptprozess Anfragen an). */
export function connectWindowDir(shellDir: string): string {
  return join(shellDir, 'connect');
}

/**
 * Das kleine Hüllen-Fenster „Mit iPhone und iPad verbinden“: lokale Seite mit eigener CSP und eigenem Preload.
 * Der Hauptprozess nimmt nur Anfragen dieser Seite an (Absender-Adresse und -Fenster), prüft jede Eingabe und
 * lässt die Seite nie Befehle oder Adressen vorgeben.
 */
export class ConnectWindow {
  private window: BrowserWindow | null = null;
  private registered = false;

  constructor(
    private readonly controller: ConnectController,
    private readonly paths: { shellDir: string; preload: string },
    private readonly parent: () => BrowserWindow | null,
  ) {}

  /** Das Fenster, über dem Dialoge erscheinen sollen (das Verbindungsfenster, solange es offen ist). */
  parentWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  private get dirUrl(): string {
    return pathToFileURL(connectWindowDir(this.paths.shellDir)).href;
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
    handle(CHANNELS.getConnectView, () => this.controller.getView());
    handle(CHANNELS.setupServe, () => this.controller.setupServe(false));
    handle(CHANNELS.useAltPort, () => this.controller.setupServe(true));
    handle(CHANNELS.resetServe, () => this.controller.resetServe());
    handle(CHANNELS.renameHost, (name: unknown) => this.controller.renameHost(name));
    handle(CHANNELS.copyAddress, () => this.controller.copyAddress());
    handle(CHANNELS.openTailscale, () => {
      this.controller.openTailscale();
    });
    handle(CHANNELS.openAdmin, (kind: unknown) => {
      this.controller.openAdmin(kind === 'machines' ? 'machines' : 'dns');
    });
    handle(CHANNELS.openDownload, () => {
      this.controller.openDownload();
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
        title: m.connect.windowTitle,
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
    void win.loadFile(join(connectWindowDir(this.paths.shellDir), 'connect.html'));
  }
}
