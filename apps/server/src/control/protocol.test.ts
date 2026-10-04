import { describe, expect, it } from 'vitest';
import { parseCommand, parseServerMessage } from './protocol';

describe('Steuerkanal: Befehle', () => {
  it('nimmt nur bekannte Befehle mit ganzzahliger Kennung an', () => {
    expect(parseCommand({ id: 1, type: 'status' })).toEqual({ id: 1, type: 'status' });
    expect(parseCommand({ id: 0, type: 'setup-code' })).toEqual({ id: 0, type: 'setup-code' });
    expect(parseCommand({ id: 7, type: 'reset-passcode' })).toEqual({
      id: 7,
      type: 'reset-passcode',
    });
    expect(parseCommand({ id: 2, type: 'stop' })).toEqual({ id: 2, type: 'stop' });
  });

  it('verwirft alles andere, auch zusätzliche Felder werden nicht durchgereicht', () => {
    for (const bad of [
      null,
      undefined,
      'status',
      42,
      [],
      {},
      { type: 'status' },
      { id: '1', type: 'status' },
      { id: 1.5, type: 'status' },
      { id: -1, type: 'status' },
      { id: 1, type: 'eval' },
      { id: 1, type: 'constructor' },
      { id: 1, type: '__proto__' },
    ]) {
      expect(parseCommand(bad)).toBeNull();
    }
    expect(parseCommand({ id: 3, type: 'status', code: 'rm -rf' })).toEqual({
      id: 3,
      type: 'status',
    });
  });
});

describe('Steuerkanal: Meldungen des Servers', () => {
  it('liest gültige Meldungen', () => {
    expect(
      parseServerMessage({ type: 'ready', host: '127.0.0.1', port: 3000, dataDir: '/tmp/d' }),
    ).toEqual({ type: 'ready', host: '127.0.0.1', port: 3000, dataDir: '/tmp/d' });
    expect(
      parseServerMessage({ type: 'failed', kind: 'port_in_use', message: 'Port belegt' }),
    ).toEqual({ type: 'failed', kind: 'port_in_use', message: 'Port belegt' });
    expect(parseServerMessage({ type: 'stopped' })).toEqual({ type: 'stopped' });
    expect(parseServerMessage({ id: 1, type: 'reply', ok: true, value: null })).toEqual({
      id: 1,
      type: 'reply',
      ok: true,
      value: null,
    });
    expect(
      parseServerMessage({ id: 1, type: 'reply', ok: true, value: { code: 'ABCDE-FGHJK' } }),
    ).toEqual({
      id: 1,
      type: 'reply',
      ok: true,
      value: { code: 'ABCDE-FGHJK' },
    });
    expect(
      parseServerMessage({
        id: 2,
        type: 'reply',
        ok: true,
        value: { port: 3000, activeChats: 1, sessions: 2, setupPending: false, extra: 'x' },
      }),
    ).toEqual({
      id: 2,
      type: 'reply',
      ok: true,
      value: { port: 3000, activeChats: 1, sessions: 2, setupPending: false },
    });
    expect(parseServerMessage({ id: 3, type: 'reply', ok: false, error: 'busy' })).toEqual({
      id: 3,
      type: 'reply',
      ok: false,
      error: 'busy',
    });
  });

  it('verwirft fehlerhafte Meldungen', () => {
    for (const bad of [
      null,
      'ready',
      {},
      { type: 'ready', host: 1, port: 3000, dataDir: '/x' },
      { type: 'ready', host: 'h', port: 1.5, dataDir: '/x' },
      { type: 'failed', kind: 'unbekannt', message: 'x' },
      { type: 'failed', kind: 'config' },
      { type: 'reply', id: 'x', ok: true, value: null },
      { type: 'reply', id: 1, ok: true, value: { port: 'x' } },
      { type: 'reply', id: 1, ok: 'ja' },
      { type: 'etwas-anderes' },
    ]) {
      expect(parseServerMessage(bad)).toBeNull();
    }
  });
});
