import { describe, expect, it } from 'vitest';
import { installPermissionPolicy, type PermissionSession } from './permissions';

describe('Berechtigungen', () => {
  function install() {
    let request: Parameters<PermissionSession['setPermissionRequestHandler']>[0] | undefined;
    let check: Parameters<PermissionSession['setPermissionCheckHandler']>[0] | undefined;
    let device: Parameters<PermissionSession['setDevicePermissionHandler']>[0] | undefined;
    installPermissionPolicy({
      setPermissionRequestHandler: (handler) => {
        request = handler;
      },
      setPermissionCheckHandler: (handler) => {
        check = handler;
      },
      setDevicePermissionHandler: (handler) => {
        device = handler;
      },
    });
    return { request, check, device };
  }

  it('lehnt jede Anfrage ab, ohne Ausnahme', () => {
    const { request } = install();
    for (const permission of [
      'media',
      'camera',
      'microphone',
      'notifications',
      'geolocation',
      'clipboard-read',
      'midi',
      'display-capture',
      'fullscreen',
      'openExternal',
      'unbekannt',
    ]) {
      let answer: boolean | undefined;
      request?.({}, permission, (granted) => {
        answer = granted;
      });
      expect(answer, permission).toBe(false);
    }
  });

  it('antwortet auf Prüfungen und Geräteanfragen mit nein', () => {
    const { check, device } = install();
    expect(check?.({}, 'camera')).toBe(false);
    expect(check?.({}, 'notifications')).toBe(false);
    expect(device?.({ deviceType: 'usb' })).toBe(false);
    expect(device?.({ deviceType: 'hid' })).toBe(false);
  });
});
