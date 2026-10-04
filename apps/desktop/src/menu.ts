import type { MenuItemConstructorOptions } from 'electron';
import { format, messages as m } from './i18n';
import type { SupervisorSnapshot } from './supervisor';

/** Was die Menüpunkte tun. Die Verdrahtung mit Electron steht in `main.ts`, hier sind nur Daten und Verweise. */
export interface MenuActions {
  newChat(): void;
  openSettings(): void;
  print(): void;
  reload(): void;
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  closeWindow(): void;
  showConnect(): void;
  showSetupCode(): void;
  setKeepAwake(enabled: boolean): void;
  setOpenAtLogin(enabled: boolean): void;
  resetPasscode(): void;
  openDocs(): void;
  restartServer(): void;
  quit(): void;
}

export interface MenuState {
  keepAwake: boolean;
  openAtLogin: boolean;
  loginSupported: boolean;
  setupPending: boolean;
}

/** Tastenkürzel der App. Ein Test hält sie fest. */
export const SHORTCUTS = {
  newChat: 'CmdOrCtrl+N',
  settings: 'CmdOrCtrl+,',
  closeWindow: 'CmdOrCtrl+W',
  print: 'CmdOrCtrl+P',
  reload: 'CmdOrCtrl+R',
  zoomIn: 'CmdOrCtrl+Plus',
  zoomInAlt: 'CmdOrCtrl+=',
  zoomOut: 'CmdOrCtrl+-',
  resetZoom: 'CmdOrCtrl+0',
  quit: 'CmdOrCtrl+Q',
} as const;

/** Standardmenü auf Deutsch: Pagewise, Ablage, Bearbeiten, Darstellung, Fenster, Hilfe. */
export function buildMenuTemplate(
  actions: MenuActions,
  state: MenuState,
  platform: NodeJS.Platform = 'darwin',
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  const app: MenuItemConstructorOptions = {
    label: m.app.name,
    submenu: [
      { role: 'about', label: m.menu.about },
      { type: 'separator' },
      {
        label: m.menu.settings,
        accelerator: SHORTCUTS.settings,
        click: () => actions.openSettings(),
      },
      { type: 'separator' },
      { role: 'services', label: m.menu.services },
      { type: 'separator' },
      { role: 'hide', label: m.menu.hide },
      { role: 'hideOthers', label: m.menu.hideOthers },
      { role: 'unhide', label: m.menu.showAll },
      { type: 'separator' },
      { label: m.menu.quit, accelerator: SHORTCUTS.quit, click: () => actions.quit() },
    ],
  };
  const file: MenuItemConstructorOptions = {
    label: m.menu.file,
    submenu: [
      { label: m.menu.newChat, accelerator: SHORTCUTS.newChat, click: () => actions.newChat() },
      { type: 'separator' },
      { label: m.menu.print, accelerator: SHORTCUTS.print, click: () => actions.print() },
      { type: 'separator' },
      {
        label: m.menu.closeWindow,
        accelerator: SHORTCUTS.closeWindow,
        click: () => actions.closeWindow(),
      },
    ],
  };
  const edit: MenuItemConstructorOptions = {
    label: m.menu.edit,
    submenu: [
      { role: 'undo', label: m.menu.undo },
      { role: 'redo', label: m.menu.redo },
      { type: 'separator' },
      { role: 'cut', label: m.menu.cut },
      { role: 'copy', label: m.menu.copy },
      { role: 'paste', label: m.menu.paste },
      { role: 'selectAll', label: m.menu.selectAll },
    ],
  };
  const view: MenuItemConstructorOptions = {
    label: m.menu.view,
    submenu: [
      { label: m.menu.reload, accelerator: SHORTCUTS.reload, click: () => actions.reload() },
      { type: 'separator' },
      { label: m.menu.zoomIn, accelerator: SHORTCUTS.zoomIn, click: () => actions.zoomIn() },
      // Auf manchen Tastaturen liegt das Pluszeichen auf „=“: zweites, verborgenes Kürzel.
      {
        label: m.menu.zoomIn,
        accelerator: SHORTCUTS.zoomInAlt,
        visible: false,
        click: () => actions.zoomIn(),
      },
      { label: m.menu.zoomOut, accelerator: SHORTCUTS.zoomOut, click: () => actions.zoomOut() },
      {
        label: m.menu.resetZoom,
        accelerator: SHORTCUTS.resetZoom,
        click: () => actions.resetZoom(),
      },
      { type: 'separator' },
      { role: 'togglefullscreen', label: m.menu.fullscreen },
    ],
  };
  const window: MenuItemConstructorOptions = {
    label: m.menu.window,
    role: 'window',
    submenu: [
      { role: 'minimize', label: m.menu.minimize },
      { role: 'zoom', label: m.menu.zoom },
      { type: 'separator' },
      { role: 'front', label: m.menu.front },
    ],
  };
  const help: MenuItemConstructorOptions = {
    label: m.menu.help,
    role: 'help',
    submenu: [
      { label: m.menu.connect, click: () => actions.showConnect() },
      {
        label: m.menu.setupCode,
        enabled: state.setupPending,
        click: () => actions.showSetupCode(),
      },
      { type: 'separator' },
      {
        label: m.menu.keepAwake,
        type: 'checkbox',
        checked: state.keepAwake,
        click: (item) => actions.setKeepAwake(item.checked),
      },
      ...(state.loginSupported
        ? [
            {
              label: m.menu.openAtLogin,
              type: 'checkbox' as const,
              checked: state.openAtLogin,
              click: (item: { checked: boolean }) => actions.setOpenAtLogin(item.checked),
            },
          ]
        : []),
      { type: 'separator' },
      { label: m.menu.restartServer, click: () => actions.restartServer() },
      { label: m.menu.resetPasscode, click: () => actions.resetPasscode() },
      { type: 'separator' },
      { label: m.menu.docs, click: () => actions.openDocs() },
    ],
  };
  // Der Anwendungsmenüpunkt gehört nur auf den Mac an die erste Stelle, sonst unter „Ablage“.
  return mac ? [app, file, edit, view, window, help] : [file, edit, view, window, help];
}

/** Text des Serverzustands für Menüleisten-Symbol und Hilfe. */
export function serverLabel(snapshot: SupervisorSnapshot): string {
  switch (snapshot.state) {
    case 'running':
      return format(m.server.running, { port: snapshot.port ?? '?' });
    case 'starting':
      return m.server.starting;
    case 'restarting':
      return m.server.restarting;
    case 'failed':
      return m.server.failed;
    case 'stopped':
      return m.server.stopped;
  }
}
