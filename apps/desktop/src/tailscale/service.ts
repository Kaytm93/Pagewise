import { type Exec, type FoundCli, findCli } from './cli';
import { isValidHostLabel, looksPersonal } from './hostname';
import { analyzeServe, parseServe, pickHttpsPort, type ServeAnalysis } from './serve';
import { httpsEnabled, type ParsedStatus, parseJson, parseStatus } from './status';

/** Zustände, die die Oberfläche zeigt. */
export type TailscaleState =
  | 'not-installed'
  | 'not-logged-in'
  | 'needs-approval'
  | 'stopped'
  | 'starting'
  | 'https-disabled'
  | 'running';

export interface Inspection {
  state: TailscaleState;
  cliPath: string | null;
  dnsName: string | null;
  hostLabel: string | null;
  /** `null`, wenn die Freigaben nicht lesbar waren (Tailscale läuft nicht oder HTTPS ist aus). */
  serve: ServeAnalysis | null;
  /** HTTPS-Port unserer Freigabe, sonst `null`. */
  servePort: number | null;
  /** `https://<name>` (mit `:<Port>`, wenn nicht 443), wenn unsere Freigabe aktiv ist. */
  address: string | null;
  /** Irgendeine Freigabe ist über Funnel im Internet erreichbar. */
  funnel: boolean;
  hostnamePersonal: boolean;
  /** Port für „Freigabe einrichten“: 443, sonst ein Ausweichport, `null`, wenn alle belegt sind. */
  proposedPort: number | null;
  /** Auf 443 liegt schon eine fremde Freigabe. */
  conflictOn443: boolean;
}

export type ActionFailure =
  | 'not-running'
  | 'busy'
  | 'invalid-name'
  | 'no-port'
  | 'foreign'
  | 'funnel-risk'
  | 'command-failed'
  | 'timeout'
  | 'verify-failed';

export type ActionResult =
  | { ok: true; inspection: Inspection }
  | { ok: false; reason: ActionFailure };

export interface ServiceOptions {
  exec: Exec;
  /** Port des lokalen Servers. */
  localPort: number;
  exists?: (path: string) => boolean;
  pathEnv?: string;
  commandTimeoutMs?: number;
}

const COMMAND_TIMEOUT_MS = 20_000;

/**
 * Tailscale für Pagewise: ablesen, was los ist, und die Freigabe über Tailscale Serve einrichten. Nie `funnel`
 * (öffentlich im Internet), nie eine fremde Freigabe überschreiben, Aufrufe ohne Shell mit Zeitlimit.
 * Befehle (Quelle: `cmd/tailscale/cli/serve_v2.go` und `set.go`, Hauptzweig, gelesen am 4. Oktober 2026):
 *   tailscale serve status --json
 *   tailscale serve --bg --yes [--https=<Port>] <lokaler Port>
 *   tailscale serve reset
 *   tailscale set --hostname=<Name>
 */
export class TailscaleService {
  private busy = false;

  constructor(private readonly options: ServiceOptions) {}

  async inspect(): Promise<Inspection> {
    const found = await findCli(this.options.exec, {
      exists: this.options.exists,
      pathEnv: this.options.pathEnv,
    });
    if (!found) return this.empty('not-installed', null);
    return this.inspectWith(found);
  }

  private empty(state: TailscaleState, cliPath: string | null, status?: ParsedStatus): Inspection {
    return {
      state,
      cliPath,
      dnsName: status?.dnsName ?? null,
      hostLabel: status?.hostLabel ?? null,
      serve: null,
      servePort: null,
      address: null,
      funnel: false,
      hostnamePersonal: looksPersonal(status?.hostLabel ?? null),
      proposedPort: null,
      conflictOn443: false,
    };
  }

  private async inspectWith(found: FoundCli): Promise<Inspection> {
    const json = parseJson(found.status.stdout);
    if (json === null) return this.empty('stopped', found.path);
    const status = parseStatus(json);
    switch (status.backendState) {
      case 'NeedsLogin':
      case 'NoState':
        return this.empty('not-logged-in', found.path, status);
      case 'NeedsMachineAuth':
        return this.empty('needs-approval', found.path, status);
      case 'Starting':
        return this.empty('starting', found.path, status);
      case 'Running':
        break;
      default:
        return this.empty('stopped', found.path, status);
    }
    if (!httpsEnabled(status)) return this.empty('https-disabled', found.path, status);

    const serveResult = await this.options.exec(
      found.path,
      ['serve', 'status', '--json'],
      this.options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS,
    );
    const analysis = analyzeServe(
      parseServe(parseJson(serveResult.stdout)),
      this.options.localPort,
    );
    const dns = status.dnsName;
    const servePort = analysis.ours?.port ?? null;
    return {
      state: 'running',
      cliPath: found.path,
      dnsName: dns,
      hostLabel: status.hostLabel,
      serve: analysis,
      servePort,
      address:
        dns && servePort !== null
          ? `https://${dns}${servePort === 443 ? '' : `:${servePort}`}`
          : null,
      funnel: analysis.funnel,
      hostnamePersonal: looksPersonal(status.hostLabel),
      proposedPort: servePort === null ? pickHttpsPort(analysis) : null,
      conflictOn443: analysis.foreign.some((f) => f.port === 443),
    };
  }

  private async guarded<T>(work: () => Promise<T>): Promise<T | { ok: false; reason: 'busy' }> {
    if (this.busy) return { ok: false, reason: 'busy' };
    this.busy = true;
    try {
      return await work();
    } finally {
      this.busy = false;
    }
  }

  private async command(path: string, args: string[]): Promise<ActionFailure | null> {
    const result = await this.options.exec(
      path,
      args,
      this.options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS,
    );
    if (result.timedOut) return 'timeout';
    if (!result.spawned || result.code !== 0) return 'command-failed';
    return null;
  }

  /**
   * Richtet die Freigabe ein (idempotent): Liegt unsere Freigabe schon, passiert nichts. Fremde Freigaben auf dem
   * Port werden nie überschreiben; ist 443 belegt, nimmt die Freigabe einen Ausweichport (`httpsPort`, sonst der
   * erste freie), sofern die Person es verlangt.
   */
  async setupServe(request: { httpsPort?: number } = {}): Promise<ActionResult> {
    return this.guarded(async () => {
      const before = await this.inspect();
      if (before.state !== 'running' || !before.cliPath || !before.serve) {
        return { ok: false, reason: 'not-running' } as const;
      }
      if (before.serve.ours) return { ok: true, inspection: before } as const;
      const port = request.httpsPort ?? before.proposedPort;
      if (port === null || ![443, 8443, 10000].includes(port))
        return { ok: false, reason: 'no-port' } as const;
      if (before.serve.foreign.some((f) => f.port === port))
        return { ok: false, reason: 'foreign' } as const;

      const args = [
        'serve',
        '--bg',
        '--yes',
        ...(port === 443 ? [] : [`--https=${port}`]),
        String(this.options.localPort),
      ];
      const failure = await this.command(before.cliPath, args);
      if (failure) return { ok: false, reason: failure } as const;
      const after = await this.inspect();
      return after.serve?.ours
        ? ({ ok: true, inspection: after } as const)
        : ({ ok: false, reason: 'verify-failed' } as const);
    });
  }

  /** `tailscale serve reset`: nimmt **alle** Freigaben dieses Rechners weg (auch fremde), nur auf ausdrücklichen Wunsch. */
  async resetServe(): Promise<ActionResult> {
    return this.guarded(async () => {
      const before = await this.inspect();
      if (!before.cliPath || before.state === 'not-installed')
        return { ok: false, reason: 'not-running' } as const;
      const failure = await this.command(before.cliPath, ['serve', 'reset']);
      if (failure) return { ok: false, reason: failure } as const;
      return { ok: true, inspection: await this.inspect() } as const;
    });
  }

  /** `tailscale set --hostname=<Name>`. Danach ändern sich Adresse und Herkunft der iOS-App (neu anmelden). */
  async renameHost(label: string): Promise<ActionResult> {
    return this.guarded(async () => {
      if (!isValidHostLabel(label)) return { ok: false, reason: 'invalid-name' } as const;
      const before = await this.inspect();
      if (!before.cliPath || before.state === 'not-installed')
        return { ok: false, reason: 'not-running' } as const;
      const failure = await this.command(before.cliPath, ['set', `--hostname=${label}`]);
      if (failure) return { ok: false, reason: failure } as const;
      return { ok: true, inspection: await this.inspect() } as const;
    });
  }
}
