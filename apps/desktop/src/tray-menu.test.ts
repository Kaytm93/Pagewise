import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { SupervisorSnapshot } from './supervisor';
import { buildTrayMenuTemplate, type TrayActions } from './tray-menu';

function actions(): TrayActions {
  return {
    openWindow: vi.fn(),
    setKeepAwake: vi.fn(),
    copyAddress: vi.fn(),
    showConnect: vi.fn(),
    restartServer: vi.fn(),
    quit: vi.fn(),
  };
}
const RUNNING: SupervisorSnapshot = { state: 'running', port: 3000, failure: null, restarts: 0 };
const labels = (menu: MenuItemConstructorOptions[]) => menu.map((i) => i.label ?? '—');
const click = (item: MenuItemConstructorOptions | undefined, extra: object = {}) =>
  (item?.click as unknown as ((i: object) => void) | undefined)?.(extra);

describe('Menü des Menüleisten-Symbols', () => {
  it('zeigt Serverstatus, Fenster öffnen, Mac wach halten, Adresse kopieren und Beenden', () => {
    const menu = buildTrayMenuTemplate(actions(), {
      server: RUNNING,
      keepAwake: true,
      address: 'https://beispiel.tailnet.ts.net',
    });
    expect(labels(menu)).toEqual([
      'Server läuft (Port 3000)',
      '—',
      'Pagewise öffnen',
      'Mac wach halten',
      '—',
      'Tailscale-Adresse kopieren',
      'Mit iPhone und iPad verbinden …',
      '—',
      'Pagewise beenden',
    ]);
    expect(menu[0]?.enabled).toBe(false);
  });

  it('verdrahtet jeden Punkt', () => {
    const a = actions();
    const menu = buildTrayMenuTemplate(a, {
      server: RUNNING,
      keepAwake: false,
      address: 'https://x.ts.net',
    });
    const by = (label: string) => menu.find((i) => i.label === label);
    click(by('Pagewise öffnen'));
    click(by('Tailscale-Adresse kopieren'));
    click(by('Mit iPhone und iPad verbinden …'));
    click(by('Pagewise beenden'));
    click(by('Mac wach halten'), { checked: true });
    expect(a.openWindow).toHaveBeenCalledTimes(1);
    expect(a.copyAddress).toHaveBeenCalledTimes(1);
    expect(a.showConnect).toHaveBeenCalledTimes(1);
    expect(a.quit).toHaveBeenCalledTimes(1);
    expect(a.setKeepAwake).toHaveBeenCalledWith(true);
    expect(by('Mac wach halten')).toMatchObject({ type: 'checkbox', checked: false });
  });

  it('bietet ohne bekannte Adresse den Weg zum Einrichten an, statt zu kopieren', () => {
    const a = actions();
    const menu = buildTrayMenuTemplate(a, { server: RUNNING, keepAwake: true, address: null });
    expect(labels(menu)).not.toContain('Tailscale-Adresse kopieren');
    click(menu.find((i) => i.label === 'Tailscale-Adresse (noch nicht eingerichtet)'));
    expect(a.showConnect).toHaveBeenCalledTimes(1);
    expect(a.copyAddress).not.toHaveBeenCalled();
  });

  it('zeigt bei einem Fehler den Grund und „Server neu starten“', () => {
    const a = actions();
    const menu = buildTrayMenuTemplate(a, {
      server: {
        state: 'failed',
        port: null,
        restarts: 0,
        failure: {
          kind: 'port_in_use',
          message: 'Der Port 3000 auf 127.0.0.1 ist belegt.\nWeitere Zeilen',
        },
      },
      keepAwake: true,
      address: null,
    });
    expect(labels(menu).slice(0, 3)).toEqual([
      'Server läuft nicht',
      'Der Port 3000 auf 127.0.0.1 ist belegt.',
      'Server neu starten',
    ]);
    click(menu[2]);
    expect(a.restartServer).toHaveBeenCalledTimes(1);
  });
});
