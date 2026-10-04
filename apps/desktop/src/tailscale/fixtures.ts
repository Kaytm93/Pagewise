import type { Exec, ExecResult } from './cli';

/**
 * Erfundene, aber im Aufbau echte Ausgaben von `tailscale status --json` und `tailscale serve status --json`
 * (Felder nach `ipnstate.Status` und `ipn.ServeConfig`, Quelle siehe `status.ts` und `serve.ts`). Namen und
 * Adressen sind offensichtlich erfunden (`pagewise-mac.tail0000.ts.net`).
 */
export const DNS = 'pagewise-mac.tail0000.ts.net';

export function statusJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    Version: '1.90.0-test',
    TUN: true,
    BackendState: 'Running',
    HaveNodeKey: true,
    AuthURL: '',
    TailscaleIPs: ['100.64.0.1', 'fd7a:115c:a1e0::1'],
    Self: { ID: 'n1', HostName: 'Pagewise-Mac', DNSName: `${DNS}.`, OS: 'macOS', Online: true },
    Health: [],
    MagicDNSSuffix: 'tail0000.ts.net',
    CurrentTailnet: {
      Name: 'beispiel@example.test',
      MagicDNSSuffix: 'tail0000.ts.net',
      MagicDNSEnabled: true,
    },
    CertDomains: [DNS],
    Peer: {},
    User: {},
    ...overrides,
  });
}

/** Unsere Freigabe: HTTPS auf `port`, Weiterleitung an den lokalen Server. */
export function serveJson(
  options: {
    port?: number;
    target?: string;
    funnel?: boolean;
    extra?: Record<string, unknown>;
  } = {},
): string {
  const port = options.port ?? 443;
  const hostPort = `${DNS}:${port}`;
  return JSON.stringify({
    TCP: { [port]: { HTTPS: true } },
    Web: {
      [hostPort]: { Handlers: { '/': { Proxy: options.target ?? 'http://127.0.0.1:3000' } } },
    },
    ...(options.funnel ? { AllowFunnel: { [hostPort]: true } } : {}),
    ...options.extra,
  });
}

export const EMPTY_SERVE = '{}';

export interface Call {
  file: string;
  args: string[];
}

export interface FakeExecOptions {
  /** Welche Programme „existieren“ (sonst ENOENT). */
  statusOutput?: string | (() => string);
  statusCode?: number;
  statusStderr?: string;
  serveOutput?: string | (() => string);
  /** Antwort auf Befehle, die etwas ändern (`serve --bg …`, `serve reset`, `set …`). */
  onCommand?: (call: Call) => Partial<ExecResult> | undefined;
}

const ok = (stdout = ''): ExecResult => ({
  spawned: true,
  code: 0,
  stdout,
  stderr: '',
  timedOut: false,
});

/** Ersatz für `execFile`: antwortet nach Befehl, schreibt alle Aufrufe mit. */
export function fakeExec(options: FakeExecOptions = {}) {
  const calls: Call[] = [];
  const exec: Exec = async (file, args) => {
    calls.push({ file, args: [...args] });
    const joined = args.join(' ');
    if (joined === 'status --json') {
      const out =
        typeof options.statusOutput === 'function'
          ? options.statusOutput()
          : (options.statusOutput ?? statusJson());
      return { ...ok(out), code: options.statusCode ?? 0, stderr: options.statusStderr ?? '' };
    }
    if (joined === 'serve status --json') {
      const out =
        typeof options.serveOutput === 'function'
          ? options.serveOutput()
          : (options.serveOutput ?? EMPTY_SERVE);
      return ok(out);
    }
    const custom = options.onCommand?.({ file, args: [...args] });
    return { ...ok(), ...custom };
  };
  return { exec, calls };
}
