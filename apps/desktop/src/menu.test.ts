import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  buildMenuTemplate,
  type MenuActions,
  type MenuState,
  SHORTCUTS,
  serverLabel,
} from './menu';

function actions(): MenuActions {
  return {
    newChat: vi.fn(),
    openSettings: vi.fn(),
    print: vi.fn(),
    reload: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
    closeWindow: vi.fn(),
    showConnect: vi.fn(),
    showSetupCode: vi.fn(),
    setKeepAwake: vi.fn(),
    setOpenAtLogin: vi.fn(),
    resetPasscode: vi.fn(),
    openDocs: vi.fn(),
    restartServer: vi.fn(),
    quit: vi.fn(),
  };
}
const STATE: MenuState = {
  keepAwake: true,
  openAtLogin: false,
  loginSupported: true,
  setupPending: false,
};

const items = (menu: MenuItemConstructorOptions): MenuItemConstructorOptions[] =>
  (menu.submenu as MenuItemConstructorOptions[]) ?? [];
const find = (menu: MenuItemConstructorOptions, label: string) =>
  items(menu).find((item) => item.label === label);
const click = (item: MenuItemConstructorOptions | undefined, extra: object = {}) =>
  (item?.click as unknown as ((i: object) => void) | undefined)?.(extra);

describe('Menü', () => {
  it('hat auf dem Mac die deutschen Menüs in der erwarteten Reihenfolge', () => {
    const menu = buildMenuTemplate(actions(), STATE);
    expect(menu.map((m) => m.label)).toEqual([
      'Pagewise',
      'Ablage',
      'Bearbeiten',
      'Darstellung',
      'Fenster',
      'Hilfe',
    ]);
  });

  it('hält die Tastenkürzel fest', () => {
    expect(SHORTCUTS).toEqual({
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
    });
  });

  it('verdrahtet Kürzel und Punkte mit den Aktionen', () => {
    const a = actions();
    const [app, file, , view, , help] = buildMenuTemplate(a, STATE) as [
      MenuItemConstructorOptions,
      MenuItemConstructorOptions,
      MenuItemConstructorOptions,
      MenuItemConstructorOptions,
      MenuItemConstructorOptions,
      MenuItemConstructorOptions,
    ];

    expect(find(file, 'Neuer Chat')?.accelerator).toBe('CmdOrCtrl+N');
    click(find(file, 'Neuer Chat'));
    expect(a.newChat).toHaveBeenCalledTimes(1);

    expect(find(app, 'Einstellungen …')?.accelerator).toBe('CmdOrCtrl+,');
    click(find(app, 'Einstellungen …'));
    expect(a.openSettings).toHaveBeenCalledTimes(1);

    expect(find(file, 'Fenster schließen')?.accelerator).toBe('CmdOrCtrl+W');
    click(find(file, 'Fenster schließen'));
    expect(a.closeWindow).toHaveBeenCalledTimes(1);

    expect(find(file, 'Drucken …')?.accelerator).toBe('CmdOrCtrl+P');
    click(find(file, 'Drucken …'));
    expect(a.print).toHaveBeenCalledTimes(1);

    expect(find(view, 'Neu laden')?.accelerator).toBe('CmdOrCtrl+R');
    click(find(view, 'Neu laden'));
    expect(a.reload).toHaveBeenCalledTimes(1);

    const zoomIns = items(view).filter((item) => item.label === 'Größer');
    expect(zoomIns.map((item) => item.accelerator)).toEqual(['CmdOrCtrl+Plus', 'CmdOrCtrl+=']);
    expect(zoomIns[1]?.visible).toBe(false);
    for (const item of zoomIns) click(item);
    expect(a.zoomIn).toHaveBeenCalledTimes(2);
    expect(find(view, 'Kleiner')?.accelerator).toBe('CmdOrCtrl+-');
    click(find(view, 'Kleiner'));
    expect(a.zoomOut).toHaveBeenCalledTimes(1);
    expect(find(view, 'Tatsächliche Größe')?.accelerator).toBe('CmdOrCtrl+0');
    click(find(view, 'Tatsächliche Größe'));
    expect(a.resetZoom).toHaveBeenCalledTimes(1);

    expect(find(app, 'Pagewise beenden')?.accelerator).toBe('CmdOrCtrl+Q');
    click(find(app, 'Pagewise beenden'));
    expect(a.quit).toHaveBeenCalledTimes(1);

    click(find(help, 'Mit iPhone und iPad verbinden …'));
    click(find(help, 'Server neu starten'));
    click(find(help, 'Passcode zurücksetzen …'));
    click(find(help, 'Anleitung öffnen'));
    expect(a.showConnect).toHaveBeenCalledTimes(1);
    expect(a.restartServer).toHaveBeenCalledTimes(1);
    expect(a.resetPasscode).toHaveBeenCalledTimes(1);
    expect(a.openDocs).toHaveBeenCalledTimes(1);
  });

  it('gibt die Schalter in Hilfe als Haken wieder und meldet Änderungen', () => {
    const a = actions();
    const help = buildMenuTemplate(a, { ...STATE, keepAwake: false, openAtLogin: true }).at(
      -1,
    ) as MenuItemConstructorOptions;
    const awake = find(help, 'Mac wach halten');
    expect(awake).toMatchObject({ type: 'checkbox', checked: false });
    click(awake, { checked: true });
    expect(a.setKeepAwake).toHaveBeenCalledWith(true);
    const login = find(help, 'Bei Anmeldung starten');
    expect(login).toMatchObject({ type: 'checkbox', checked: true });
    click(login, { checked: false });
    expect(a.setOpenAtLogin).toHaveBeenCalledWith(false);
  });

  it('zeigt den Einrichtungscode nur an, solange Pagewise nicht eingerichtet ist', () => {
    const on = buildMenuTemplate(actions(), { ...STATE, setupPending: true }).at(
      -1,
    ) as MenuItemConstructorOptions;
    const off = buildMenuTemplate(actions(), STATE).at(-1) as MenuItemConstructorOptions;
    expect(find(on, 'Einrichtungscode anzeigen …')?.enabled).toBe(true);
    expect(find(off, 'Einrichtungscode anzeigen …')?.enabled).toBe(false);
  });

  it('lässt den Start bei Anmeldung weg, wo es ihn nicht gibt', () => {
    const help = buildMenuTemplate(actions(), { ...STATE, loginSupported: false }).at(
      -1,
    ) as MenuItemConstructorOptions;
    expect(find(help, 'Bei Anmeldung starten')).toBeUndefined();
  });

  it('enthält keine Entwicklerwerkzeuge und keinen „Alles neu laden“-Umweg', () => {
    const text = JSON.stringify(buildMenuTemplate(actions(), STATE));
    expect(text).not.toMatch(/toggleDevTools|forceReload|Entwickler/);
  });

  it('beschreibt den Serverzustand in Worten', () => {
    const base = { port: null, failure: null, restarts: 0 };
    expect(serverLabel({ ...base, state: 'running', port: 3000 })).toBe('Server läuft (Port 3000)');
    expect(serverLabel({ ...base, state: 'starting' })).toBe('Server startet …');
    expect(serverLabel({ ...base, state: 'restarting' })).toBe('Server startet neu …');
    expect(serverLabel({ ...base, state: 'failed' })).toBe('Server läuft nicht');
    expect(serverLabel({ ...base, state: 'stopped' })).toBe('Server gestoppt');
  });
});
