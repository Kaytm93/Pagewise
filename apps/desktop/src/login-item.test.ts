import { describe, expect, it } from 'vitest';
import { type LoginItemApi, readLoginItem, setOpenAtLogin, shouldStartHidden } from './login-item';

function api(initial: ReturnType<LoginItemApi['getLoginItemSettings']>) {
  let current = initial;
  const calls: Array<{ openAtLogin: boolean }> = [];
  const impl: LoginItemApi = {
    getLoginItemSettings: () => current,
    setLoginItemSettings: (settings) => {
      calls.push(settings);
      current = {
        ...current,
        openAtLogin: settings.openAtLogin,
        status: settings.openAtLogin ? 'enabled' : 'not-registered',
      };
    },
  };
  return { impl, calls };
}

describe('Start bei Anmeldung', () => {
  it('liest „aus“ und „an“', () => {
    expect(
      readLoginItem(api({ openAtLogin: false, status: 'not-registered' }).impl, 'darwin'),
    ).toEqual({
      supported: true,
      enabled: false,
      needsApproval: false,
      wasOpenedAtLogin: false,
    });
    expect(
      readLoginItem(api({ openAtLogin: true, status: 'enabled' }).impl, 'darwin'),
    ).toMatchObject({
      enabled: true,
      needsApproval: false,
    });
  });

  it('erkennt „braucht Freigabe in den Systemeinstellungen“', () => {
    const state = readLoginItem(
      api({ openAtLogin: false, status: 'requires-approval' }).impl,
      'darwin',
    );
    expect(state).toMatchObject({ enabled: true, needsApproval: true });
  });

  it('meldet, ob macOS die App bei der Anmeldung gestartet hat', () => {
    const state = readLoginItem(
      api({ openAtLogin: true, status: 'enabled', wasOpenedAtLogin: true }).impl,
      'darwin',
    );
    expect(state.wasOpenedAtLogin).toBe(true);
    expect(shouldStartHidden(state, [])).toBe(true);
    expect(shouldStartHidden({ ...state, wasOpenedAtLogin: false }, ['pagewise', '--hidden'])).toBe(
      true,
    );
    expect(shouldStartHidden({ ...state, wasOpenedAtLogin: false }, ['pagewise'])).toBe(false);
  });

  it('schaltet über die API ein und aus, ohne Argumente (Electron 44 auf macOS kennt keine)', () => {
    const { impl, calls } = api({ openAtLogin: false, status: 'not-registered' });
    expect(setOpenAtLogin(impl, true, 'darwin')).toMatchObject({ enabled: true });
    expect(setOpenAtLogin(impl, false, 'darwin')).toMatchObject({ enabled: false });
    expect(calls).toEqual([{ openAtLogin: true }, { openAtLogin: false }]);
  });

  it('tut außerhalb von macOS nichts und meldet „nicht unterstützt“', () => {
    const { impl, calls } = api({ openAtLogin: false });
    expect(setOpenAtLogin(impl, true, 'linux')).toEqual({
      supported: false,
      enabled: false,
      needsApproval: false,
      wasOpenedAtLogin: false,
    });
    expect(calls).toEqual([]);
  });
});
