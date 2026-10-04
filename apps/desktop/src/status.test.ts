import { describe, expect, it } from 'vitest';
import { buildDesktopStatus } from './status';

const LOGIN = { supported: true, enabled: true, needsApproval: false, wasOpenedAtLogin: false };

describe('Statusstruktur', () => {
  it('hat genau diese Felder (Anmeldungen, nicht „Geräte“)', () => {
    const status = buildDesktopStatus({
      server: { state: 'running', port: 3000, failure: null, restarts: 1 },
      serverStatus: { activeChats: 2, sessions: 3, setupPending: false },
      keepAwake: { enabled: true, active: true, reason: 'answers' },
      loginItem: LOGIN,
      tailscale: { state: 'running', address: 'https://beispiel.tailnet.ts.net' },
    });
    expect(status).toEqual({
      server: { state: 'running', port: 3000, failure: null, restarts: 1 },
      runningAnswers: 2,
      logins: 3,
      setupPending: false,
      keepAwake: { enabled: true, active: true, reason: 'answers' },
      loginItem: LOGIN,
      tailscale: { state: 'running', address: 'https://beispiel.tailnet.ts.net' },
    });
    expect(Object.keys(status).sort()).toEqual(
      [
        'keepAwake',
        'logins',
        'loginItem',
        'runningAnswers',
        'server',
        'setupPending',
        'tailscale',
      ].sort(),
    );
    expect(JSON.stringify(status)).not.toMatch(/devices|geraete|geräte/i);
  });

  it('meldet fehlende Angaben als null, wenn der Server nicht antwortet', () => {
    const status = buildDesktopStatus({
      server: {
        state: 'failed',
        port: null,
        restarts: 0,
        failure: { kind: 'port_in_use', message: 'Der Port 3000 ist belegt.\nMehr Text' },
      },
      serverStatus: null,
      keepAwake: { enabled: false, active: false, reason: null },
      loginItem: LOGIN,
      tailscale: null,
    });
    expect(status.runningAnswers).toBeNull();
    expect(status.logins).toBeNull();
    expect(status.setupPending).toBeNull();
    expect(status.tailscale).toBeNull();
    expect(status.server.failure).toBe('Der Port 3000 ist belegt.');
  });

  it('enthält nie den Einrichtungscode oder Secrets (nur ob die Einrichtung offen ist)', () => {
    const json = JSON.stringify(
      buildDesktopStatus({
        server: { state: 'running', port: 3000, failure: null, restarts: 0 },
        serverStatus: { activeChats: 0, sessions: 0, setupPending: true },
        keepAwake: { enabled: true, active: true, reason: 'user' },
        loginItem: LOGIN,
        tailscale: null,
      }),
    );
    expect(json).toContain('"setupPending":true');
    expect(json).not.toMatch(/[A-Z0-9]{5}-[A-Z0-9]{5}/);
  });
});
