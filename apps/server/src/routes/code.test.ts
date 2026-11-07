import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lockHash, PythonRuntime } from '../python/runtime';
import { SandboxGuard } from '../sandbox/probe';
import { createHarness, type Harness, type Session } from '../test-harness';

// Zwei offensichtlich erfundene Lock-Texte: die Marke trägt die Prüfsumme des einen, der Server
// erwartet die andere. So entsteht „outdated“ ohne echtes Python und ohne Netz.
const ALTES_LOCK = 'beispielpaket==1.0 --hash=sha256:0000\n';
const NEUES_LOCK = 'anderes-paket==2.0 --hash=sha256:1111\n';

const GUARD_OK = { ok: true, failed: [] as string[] };

/** Status-Endpoint (D-079/D-103): der Runtime-Zustand wird durchgereicht, „outdated“ bietet nichts an. */
describe('Code-Status: Runtime-Zustand', () => {
  let harness: Harness;
  let session: Session;
  let base: string;
  let runtime: PythonRuntime;

  beforeEach(async () => {
    base = mkdtempSync(join(tmpdir(), 'pagewise-code-status-'));
    // Entpacktes Python, Pakete und Schriftzwischenspeicher als leere Stände: state() erreicht
    // dadurch die Marke, statt vorher als „missing“ abzukürzen.
    mkdirSync(join(base, 'python', 'runtime', 'python', 'bin'), { recursive: true });
    mkdirSync(join(base, 'python', 'site', 'beispielpaket'), { recursive: true });
    mkdirSync(join(base, 'python', 'mpl'), { recursive: true });
    writeFileSync(
      join(base, 'python', 'runtime', 'python', 'bin', 'python3'),
      '#!/bin/sh\nexit 0\n',
      {
        mode: 0o755,
      },
    );
    runtime = new PythonRuntime(base, () => NEUES_LOCK, 'darwin-arm64');
    const guard = new SandboxGuard();
    // Nur der „ready“-Selbsttest braucht den Wächter; „outdated“ darf ihn nie erreichen.
    guard.check = async () => GUARD_OK;
    guard.reset = vi.fn();
    harness = createHarness({ code: { runtime, guard } });
    session = await harness.signIn();
  });
  afterEach(() => {
    harness.close();
    rmSync(base, { recursive: true, force: true });
  });

  const marke = (lockSha256: string) => ({
    pythonVersion: '3.13.18',
    release: '20261026',
    lockSha256,
    installedAt: '2026-01-01T00:00:00.000Z',
  });

  it('meldet einen veralteten Lock: runtime „outdated“, ready false, keine Angaben fürs Werkzeug', async () => {
    writeFileSync(runtime.layout.marker, JSON.stringify(marke(lockHash(ALTES_LOCK))), {
      mode: 0o600,
    });
    expect(runtime.state()).toBe('outdated');
    expect(runtime.info()).toBeNull();
    const reply = await session.call('GET', '/api/code/status');
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ runtime: 'outdated', ready: false });
    // Auch die Einrichtung zeigt nichts „Fertiges“ an (fail-closed, kein Fallback).
    expect(reply.body.setup).toMatchObject({ state: 'idle' });
  });

  it('meldet „ready“, wenn die Marke zum erwarteten Lock passt', async () => {
    writeFileSync(runtime.layout.marker, JSON.stringify(marke(lockHash(NEUES_LOCK))), {
      mode: 0o600,
    });
    expect(runtime.state()).toBe('ready');
    const reply = await session.call('GET', '/api/code/status');
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ runtime: 'ready', ready: true });
  });
});
