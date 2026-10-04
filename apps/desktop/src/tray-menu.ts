import type { MenuItemConstructorOptions } from 'electron';
import { messages as m } from './i18n';
import { serverLabel } from './menu';
import type { SupervisorSnapshot } from './supervisor';

export interface TrayActions {
  openWindow(): void;
  setKeepAwake(enabled: boolean): void;
  copyAddress(): void;
  showConnect(): void;
  restartServer(): void;
  quit(): void;
}

export interface TrayState {
  server: SupervisorSnapshot;
  keepAwake: boolean;
  /** Adresse im Tailnet (`https://…ts.net`), wenn bekannt. */
  address: string | null;
}

/** Menü des Menüleisten-Symbols: Serverstatus, Fenster öffnen, Mac wach halten, Adresse kopieren, Beenden. */
export function buildTrayMenuTemplate(
  actions: TrayActions,
  state: TrayState,
): MenuItemConstructorOptions[] {
  return [
    { label: serverLabel(state.server), enabled: false },
    ...(state.server.failure
      ? ([{ label: state.server.failure.message.split('\n')[0] ?? '', enabled: false }] as const)
      : []),
    ...(state.server.state === 'failed'
      ? ([{ label: m.menu.restartServer, click: () => actions.restartServer() }] as const)
      : []),
    { type: 'separator' },
    { label: m.tray.open, click: () => actions.openWindow() },
    {
      label: m.menu.keepAwake,
      type: 'checkbox',
      checked: state.keepAwake,
      click: (item) => actions.setKeepAwake(item.checked),
    },
    { type: 'separator' },
    state.address
      ? { label: m.tray.copyAddress, click: () => actions.copyAddress() }
      : { label: m.tray.noAddress, click: () => actions.showConnect() },
    { label: m.menu.connect, click: () => actions.showConnect() },
    { type: 'separator' },
    { label: m.tray.quit, click: () => actions.quit() },
  ];
}
