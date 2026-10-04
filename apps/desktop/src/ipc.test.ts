import { describe, expect, it } from 'vitest';
import { CHANNELS, isTrustedSender } from './ipc';

const DIR = 'file:///Applications/Pagewise.app/Contents/Resources/app.asar/dist/shell/connect';

describe('IPC mit Hüllen-Fenstern', () => {
  it('hat genau die festen Kanäle', () => {
    expect(CHANNELS).toEqual({
      getStatus: 'pagewise:get-status',
      getConnectView: 'pagewise:connect:get-view',
      setupServe: 'pagewise:connect:setup-serve',
      useAltPort: 'pagewise:connect:use-alt-port',
      resetServe: 'pagewise:connect:reset-serve',
      renameHost: 'pagewise:connect:rename-host',
      copyAddress: 'pagewise:connect:copy-address',
      openTailscale: 'pagewise:connect:open-tailscale',
      openAdmin: 'pagewise:connect:open-admin',
      openDownload: 'pagewise:connect:open-download',
    });
  });

  it('vertraut nur Seiten aus dem eigenen Ordner', () => {
    expect(isTrustedSender(`${DIR}/connect.html`, DIR)).toBe(true);
    expect(isTrustedSender(`${DIR}/connect.html?x=1#y`, DIR)).toBe(true);
    expect(isTrustedSender(`${DIR}/connect.html`, `${DIR}/`)).toBe(true);
  });

  it('vertraut nie dem Server-Inhalt, fremden Dateien oder Umwegen', () => {
    for (const url of [
      undefined,
      '',
      'http://127.0.0.1:3000/',
      'https://example.org/',
      'file:///etc/passwd',
      'file:///Applications/Pagewise.app/Contents/Resources/app.asar/dist/shell/starting.html',
      `${DIR}x/connect.html`,
      `${DIR}/../starting.html`,
      'file://fremder-rechner/Applications/Pagewise.app/Contents/Resources/app.asar/dist/shell/connect/connect.html',
      'data:text/html,<script>1</script>',
      'about:blank',
      'kaputt',
    ]) {
      expect(isTrustedSender(url, DIR), String(url)).toBe(false);
    }
  });

  it('weist einen kaputten Ordner ab', () => {
    expect(isTrustedSender(`${DIR}/connect.html`, 'kein url')).toBe(false);
    expect(isTrustedSender(`${DIR}/connect.html`, 'http://127.0.0.1:3000/')).toBe(false);
  });
});
