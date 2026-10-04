import { describe, expect, it } from 'vitest';
import {
  CLI_CANDIDATES,
  candidatePaths,
  type ExecResult,
  findCli,
  looksLikeTailscale,
} from './cli';
import { DNS, EMPTY_SERVE, fakeExec, serveJson, statusJson } from './fixtures';
import { isValidHostLabel, looksPersonal, NEUTRAL_HOSTNAME } from './hostname';
import { QR_PATH_PATTERN, qrPath } from './qr';
import { analyzeServe, localPortOfTarget, parseServe, pickHttpsPort } from './serve';
import { TailscaleService } from './service';
import { cleanDnsName, httpsEnabled, parseStatus } from './status';

const result = (patch: Partial<ExecResult>): ExecResult => ({
  spawned: true,
  code: 0,
  stdout: '',
  stderr: '',
  timedOut: false,
  ...patch,
});

describe('Programm finden', () => {
  it('probiert zuerst die App von Tailscale, dann /usr/local/bin, /opt/homebrew/bin, dann den PATH', () => {
    expect(CLI_CANDIDATES).toEqual([
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
      '/usr/local/bin/tailscale',
      '/opt/homebrew/bin/tailscale',
    ]);
    expect(candidatePaths('/usr/bin:/opt/eigener/bin:/usr/local/bin')).toEqual([
      ...CLI_CANDIDATES,
      '/usr/bin/tailscale',
      '/opt/eigener/bin/tailscale',
    ]);
    expect(candidatePaths(undefined)).toEqual([...CLI_CANDIDATES]);
  });

  it('nimmt das erste Programm, das existiert und wie Tailscale antwortet, und ruft es mit status --json auf', async () => {
    const { exec, calls } = fakeExec();
    const found = await findCli(exec, {
      exists: (p) => p === '/usr/local/bin/tailscale',
      pathEnv: '',
    });
    expect(found?.path).toBe('/usr/local/bin/tailscale');
    expect(calls).toEqual([{ file: '/usr/local/bin/tailscale', args: ['status', '--json'] }]);
  });

  it('überspringt ein Programm, das sich nicht starten lässt oder nicht wie Tailscale antwortet', async () => {
    const tried: string[] = [];
    const found = await findCli(
      async (file) => {
        tried.push(file);
        if (file === CLI_CANDIDATES[0]) return result({ spawned: false, code: null });
        if (file === CLI_CANDIDATES[1])
          return result({ stdout: 'Hallo, das ist etwas anderes', code: 1 });
        return result({ stdout: statusJson() });
      },
      { exists: () => true, pathEnv: '' },
    );
    expect(found?.path).toBe('/opt/homebrew/bin/tailscale');
    expect(tried).toEqual([...CLI_CANDIDATES]);
  });

  it('gibt null zurück, wenn es keines gibt', async () => {
    const { exec, calls } = fakeExec();
    expect(await findCli(exec, { exists: () => false, pathEnv: '/usr/bin' })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('erkennt Tailscale auch an einer Fehlermeldung (Dienst läuft nicht)', () => {
    expect(
      looksLikeTailscale(
        result({
          code: 1,
          stderr: 'failed to connect to local Tailscale service; is Tailscale running?',
        }),
      ),
    ).toBe(true);
    expect(looksLikeTailscale(result({ stdout: '{"BackendState":"Stopped"}' }))).toBe(true);
    expect(looksLikeTailscale(result({ stdout: '{"foo":1}', stderr: '' }))).toBe(false);
    expect(looksLikeTailscale(result({ stdout: 'kein json' }))).toBe(false);
  });
});

describe('Status lesen (tolerant)', () => {
  it('liest Zustand, Namen ohne Punkt am Ende, Zertifikatsnamen und Suffix', () => {
    const status = parseStatus(JSON.parse(statusJson()));
    expect(status).toMatchObject({
      backendState: 'Running',
      dnsName: DNS,
      hostLabel: 'pagewise-mac',
      certDomains: [DNS],
      magicDnsSuffix: 'tail0000.ts.net',
      tailnetName: 'beispiel@example.test',
      tailscaleIps: ['100.64.0.1', 'fd7a:115c:a1e0::1'],
    });
    expect(httpsEnabled(status)).toBe(true);
  });

  it.each(['NoState', 'NeedsLogin', 'NeedsMachineAuth', 'Stopped', 'Starting', 'Running'])(
    'kennt den Zustand %s',
    (state) => {
      expect(parseStatus({ BackendState: state }).backendState).toBe(state);
    },
  );

  it('verträgt unvollständiges und fremdes JSON, ohne abzustürzen', () => {
    for (const raw of [
      null,
      undefined,
      42,
      'text',
      [],
      {},
      { BackendState: 5 },
      { Self: 'x', CurrentTailnet: [] },
      { CertDomains: 'a' },
      { Self: { DNSName: 7 } },
    ]) {
      const status = parseStatus(raw);
      expect(status.backendState).toBe('Unknown');
      expect(status.dnsName).toBeNull();
      expect(status.certDomains).toEqual([]);
      expect(httpsEnabled(status)).toBe(false);
    }
  });

  it('setzt den vollen Namen aus Rechnername und Suffix zusammen, wenn er fehlt', () => {
    const status = parseStatus({
      BackendState: 'Running',
      Self: { HostName: 'Pagewise-Mac' },
      CurrentTailnet: { MagicDNSSuffix: 'Tail0000.ts.net' },
    });
    expect(status.dnsName).toBe('pagewise-mac.tail0000.ts.net');
    expect(status.hostLabel).toBe('pagewise-mac');
  });

  it('nimmt das alte Feld MagicDNSSuffix, wenn CurrentTailnet fehlt', () => {
    expect(parseStatus({ MagicDNSSuffix: 'tail9.ts.net' }).magicDnsSuffix).toBe('tail9.ts.net');
  });

  it('entfernt Punkte am Ende und macht Namen klein', () => {
    expect(cleanDnsName('Pagewise-Mac.tail0000.ts.net.')).toBe(DNS);
    expect(cleanDnsName('a.b..')).toBe('a.b');
    expect(cleanDnsName('')).toBeNull();
    expect(cleanDnsName(null)).toBeNull();
  });

  it('meldet „HTTPS aus“, wenn keine Zertifikatsnamen da sind oder der eigene fehlt', () => {
    expect(httpsEnabled(parseStatus(JSON.parse(statusJson({ CertDomains: [] }))))).toBe(false);
    expect(httpsEnabled(parseStatus(JSON.parse(statusJson({ CertDomains: null }))))).toBe(false);
    expect(
      httpsEnabled(
        parseStatus(JSON.parse(statusJson({ CertDomains: ['anderer.tail0000.ts.net'] }))),
      ),
    ).toBe(false);
  });
});

describe('Freigaben lesen', () => {
  it('erkennt unsere Freigabe (443 auf den lokalen Server) in allen Schreibweisen des Ziels', () => {
    for (const target of [
      'http://127.0.0.1:3000',
      'http://localhost:3000',
      'http://127.0.0.1:3000/',
      'http://[::1]:3000',
      '127.0.0.1:3000',
      '3000',
    ]) {
      const analysis = analyzeServe(parseServe(JSON.parse(serveJson({ target }))), 3000);
      expect(analysis.ours, target).toEqual({ port: 443 });
      expect(analysis.foreign, target).toEqual([]);
    }
  });

  it('hält eine Freigabe auf einen anderen Port oder Pfad für fremd', () => {
    for (const target of [
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3000/api',
      'http://beispiel.test:3000',
      'https://127.0.0.1:3000',
      'unix:/tmp/x.sock',
    ]) {
      const analysis = analyzeServe(parseServe(JSON.parse(serveJson({ target }))), 3000);
      expect(analysis.ours, target).toBeNull();
      expect(analysis.foreign, target).toHaveLength(1);
    }
  });

  it('hält Dateien, Text und mehrere Pfade auf demselben Port für fremd', () => {
    const files = JSON.stringify({
      Web: { [`${DNS}:443`]: { Handlers: { '/': { Path: '/tmp/beispiel' } } } },
    });
    expect(analyzeServe(parseServe(JSON.parse(files)), 3000).ours).toBeNull();
    const two = JSON.stringify({
      Web: {
        [`${DNS}:443`]: {
          Handlers: {
            '/': { Proxy: 'http://127.0.0.1:3000' },
            '/x': { Proxy: 'http://127.0.0.1:4000' },
          },
        },
      },
    });
    const analysis = analyzeServe(parseServe(JSON.parse(two)), 3000);
    expect(analysis.ours).toBeNull();
    expect(analysis.foreign).toEqual([
      { port: 443, targets: ['http://127.0.0.1:3000', 'http://127.0.0.1:4000'] },
    ]);
  });

  it('zählt reine TCP-Weiterleitungen als fremd, nicht aber HTTPS-Einträge von Web', () => {
    const json = JSON.stringify({
      TCP: { '443': { HTTPS: true }, '5432': { TCPForward: '127.0.0.1:5432' } },
    });
    const analysis = analyzeServe(parseServe(JSON.parse(json)), 3000);
    expect(analysis.foreign).toEqual([{ port: 5432, targets: ['127.0.0.1:5432'] }]);
  });

  it('erkennt Funnel (AllowFunnel steht auf true)', () => {
    const analysis = analyzeServe(parseServe(JSON.parse(serveJson({ funnel: true }))), 3000);
    expect(analysis.funnel).toBe(true);
    expect(analysis.ours).toEqual({ port: 443 });
    expect(analyzeServe(parseServe(JSON.parse(serveJson())), 3000).funnel).toBe(false);
    const off = JSON.stringify({ AllowFunnel: { [`${DNS}:443`]: false } });
    expect(parseServe(JSON.parse(off)).funnel).toBe(false);
  });

  it('verträgt leere, unvollständige und fremde Konfigurationen', () => {
    for (const raw of [
      null,
      undefined,
      0,
      'x',
      [],
      {},
      { Web: 'x', TCP: 5, AllowFunnel: [] },
      { Web: { 'ohne-port': { Handlers: {} } } },
      { Web: { 'a:99999': {} } },
    ]) {
      const parsed = parseServe(raw);
      expect(parsed.funnel).toBe(false);
      expect(analyzeServe(parsed, 3000).ours).toBeNull();
    }
    expect(parseServe(JSON.parse(EMPTY_SERVE))).toEqual({ entries: [], tcp: [], funnel: false });
  });

  it('wählt den ersten freien Port: 443, 8443, 10000', () => {
    const base = { ours: null, funnel: false };
    expect(pickHttpsPort({ ...base, foreign: [] })).toBe(443);
    expect(pickHttpsPort({ ...base, foreign: [{ port: 443, targets: [] }] })).toBe(8443);
    expect(
      pickHttpsPort({
        ...base,
        foreign: [
          { port: 443, targets: [] },
          { port: 8443, targets: [] },
        ],
      }),
    ).toBe(10000);
    expect(
      pickHttpsPort({
        ...base,
        foreign: [443, 8443, 10000].map((port) => ({ port, targets: [] })),
      }),
    ).toBeNull();
  });

  it('versteht Ziele nur für den lokalen Rechner', () => {
    expect(localPortOfTarget('http://127.0.0.1:3000')).toBe(3000);
    expect(localPortOfTarget('localhost:3000')).toBe(3000);
    expect(localPortOfTarget('3000')).toBe(3000);
    expect(localPortOfTarget('http://192.168.0.5:3000')).toBeNull();
    expect(localPortOfTarget('http://127.0.0.1')).toBeNull();
    expect(localPortOfTarget('kein ziel')).toBeNull();
    expect(localPortOfTarget('')).toBeNull();
  });
});

describe('Rechnername (Certificate Transparency)', () => {
  it('warnt bei Namen in der Form, in der macOS sie vergibt, und bei Schulbezug', () => {
    for (const label of [
      'kays-macbook-pro',
      'max-mustermanns-macbook-air',
      'macbook-pro-von-erika',
      'lukas-imac',
      'anna-s-macbook',
      'gymnasium-pc',
      'klasse-9b-laptop',
      'mueller-mac-mini',
    ]) {
      expect(looksPersonal(label), label).toBe(true);
    }
  });

  it('warnt nicht bei neutralen Namen', () => {
    for (const label of [
      'pagewise-mac',
      'macbook-pro',
      'macbook-air-m2',
      'mac-mini',
      'mac-1',
      'studio',
      'server-2',
      'buero-mac',
      'home-server',
      null,
      '',
    ]) {
      expect(looksPersonal(label), String(label)).toBe(false);
    }
  });

  it('prüft Namen für `tailscale set --hostname` als DNS-Etikett', () => {
    expect(isValidHostLabel(NEUTRAL_HOSTNAME)).toBe(true);
    expect(isValidHostLabel('a')).toBe(true);
    expect(isValidHostLabel('a'.repeat(63))).toBe(true);
    for (const bad of [
      '',
      'a'.repeat(64),
      '-a',
      'a-',
      'A',
      'a b',
      'ä',
      'a.b',
      'a_b',
      '--hostname=x',
      'a;b',
      'a\nb',
    ]) {
      expect(isValidHostLabel(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('QR-Code', () => {
  it('liefert einen reinen Pfad ohne Stilangaben, quadratisch mit freiem Rand', () => {
    const qr = qrPath('https://pagewise-mac.tail0000.ts.net');
    expect(QR_PATH_PATTERN.test(qr.path)).toBe(true);
    expect(qr.path.startsWith('M')).toBe(true);
    // Version 3 hat 29 Module, dazu zwei Ränder zu je vier Modulen.
    expect(qr.size).toBeGreaterThanOrEqual(21 + 8);
    expect(qr.size).toBeLessThan(80);
    // Alle Koordinaten liegen im Bild.
    for (const match of qr.path.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
      const [x, y, w] = [Number(match[1]), Number(match[2]), Number(match[3])];
      expect(x).toBeGreaterThanOrEqual(4);
      expect(y).toBeGreaterThanOrEqual(4);
      expect(x + w).toBeLessThanOrEqual(qr.size - 4);
      expect(y + 1).toBeLessThanOrEqual(qr.size - 4);
    }
    expect(qr.path).not.toMatch(/style|<|>|"|'/);
  });

  it('ist für gleiche Eingabe gleich und für andere Eingaben verschieden', () => {
    expect(qrPath('https://a.example.test').path).toBe(qrPath('https://a.example.test').path);
    expect(qrPath('https://a.example.test').path).not.toBe(qrPath('https://b.example.test').path);
  });
});

describe('TailscaleService.inspect (alle Zustände)', () => {
  const service = (options: Parameters<typeof fakeExec>[0] = {}, exists = true) => {
    const fake = fakeExec(options);
    return {
      ...fake,
      service: new TailscaleService({
        exec: fake.exec,
        localPort: 3000,
        exists: () => exists,
        pathEnv: '',
      }),
    };
  };

  it('nicht installiert', async () => {
    const { service: s, calls } = service({}, false);
    expect(await s.inspect()).toMatchObject({
      state: 'not-installed',
      cliPath: null,
      address: null,
    });
    expect(calls).toEqual([]);
  });

  it('nicht angemeldet (NeedsLogin und NoState) und Gerät muss freigegeben werden', async () => {
    expect(
      (
        await service({
          statusOutput: statusJson({ BackendState: 'NeedsLogin', CertDomains: null }),
        }).service.inspect()
      ).state,
    ).toBe('not-logged-in');
    expect(
      (await service({ statusOutput: statusJson({ BackendState: 'NoState' }) }).service.inspect())
        .state,
    ).toBe('not-logged-in');
    expect(
      (
        await service({
          statusOutput: statusJson({ BackendState: 'NeedsMachineAuth' }),
        }).service.inspect()
      ).state,
    ).toBe('needs-approval');
  });

  it('gestoppt, startet, und Dienst nicht erreichbar', async () => {
    expect(
      (await service({ statusOutput: statusJson({ BackendState: 'Stopped' }) }).service.inspect())
        .state,
    ).toBe('stopped');
    expect(
      (await service({ statusOutput: statusJson({ BackendState: 'Starting' }) }).service.inspect())
        .state,
    ).toBe('starting');
    const unreachable = service({
      statusOutput: '',
      statusCode: 1,
      statusStderr: 'failed to connect to local Tailscale service; is Tailscale running?',
    });
    expect((await unreachable.service.inspect()).state).toBe('stopped');
  });

  it('HTTPS im Tailnet aus', async () => {
    const { service: s, calls } = service({ statusOutput: statusJson({ CertDomains: [] }) });
    const inspection = await s.inspect();
    expect(inspection).toMatchObject({
      state: 'https-disabled',
      dnsName: DNS,
      address: null,
      serve: null,
    });
    // Es wird nie `serve` aufgerufen, solange HTTPS aus ist (der Befehl würde interaktiv nachfragen).
    expect(calls.map((c) => c.args.join(' '))).toEqual(['status --json']);
  });

  it('läuft ohne Freigabe: schlägt 443 vor', async () => {
    const inspection = await service().service.inspect();
    expect(inspection).toMatchObject({
      state: 'running',
      dnsName: DNS,
      servePort: null,
      address: null,
      funnel: false,
      proposedPort: 443,
      conflictOn443: false,
    });
  });

  it('läuft mit unserer Freigabe: nennt die Adresse', async () => {
    const inspection = await service({ serveOutput: serveJson() }).service.inspect();
    expect(inspection).toMatchObject({
      servePort: 443,
      address: `https://${DNS}`,
      proposedPort: null,
    });
  });

  it('nennt bei Ausweichport den Port in der Adresse', async () => {
    const inspection = await service({ serveOutput: serveJson({ port: 8443 }) }).service.inspect();
    expect(inspection).toMatchObject({ servePort: 8443, address: `https://${DNS}:8443` });
  });

  it('fremde Freigabe auf 443: Konflikt und Ausweichport', async () => {
    const inspection = await service({
      serveOutput: serveJson({ target: 'http://127.0.0.1:9999' }),
    }).service.inspect();
    expect(inspection).toMatchObject({
      servePort: null,
      address: null,
      conflictOn443: true,
      proposedPort: 8443,
    });
  });

  it('Funnel an: Warnung auch bei fremder Freigabe', async () => {
    const mine = await service({ serveOutput: serveJson({ funnel: true }) }).service.inspect();
    expect(mine.funnel).toBe(true);
    const foreign = await service({
      serveOutput: serveJson({ funnel: true, target: 'http://127.0.0.1:9999' }),
    }).service.inspect();
    expect(foreign.funnel).toBe(true);
  });

  it('wirkt der Rechnername personenbezogen, meldet es die Prüfung', async () => {
    const personal = await service({
      statusOutput: statusJson({
        Self: { HostName: 'Kays-MacBook-Pro', DNSName: 'kays-macbook-pro.tail0000.ts.net.' },
        CertDomains: ['kays-macbook-pro.tail0000.ts.net'],
      }),
    }).service.inspect();
    expect(personal.hostnamePersonal).toBe(true);
    expect((await service().service.inspect()).hostnamePersonal).toBe(false);
  });

  it('kommt mit kaputter Ausgabe von serve status zurecht (keine Freigabe)', async () => {
    const inspection = await service({ serveOutput: 'kein json' }).service.inspect();
    expect(inspection).toMatchObject({ state: 'running', servePort: null, proposedPort: 443 });
  });
});

describe('TailscaleService: Aktionen', () => {
  /** Ein Tailscale, dessen Freigabe sich durch `serve --bg` und `serve reset` ändert. */
  function stateful(initial: { serve?: string; status?: string } = {}) {
    let serve = initial.serve ?? EMPTY_SERVE;
    const fake = fakeExec({
      statusOutput: () => initial.status ?? statusJson(),
      serveOutput: () => serve,
      onCommand: ({ args }) => {
        if (args[0] === 'serve' && args.includes('--bg')) {
          const https = args.find((a) => a.startsWith('--https='));
          serve = serveJson({ port: https ? Number(https.slice(8)) : 443 });
        }
        if (args[0] === 'serve' && args[1] === 'reset') serve = EMPTY_SERVE;
        return undefined;
      },
    });
    return {
      ...fake,
      service: new TailscaleService({
        exec: fake.exec,
        localPort: 3000,
        exists: () => true,
        pathEnv: '',
      }),
      setServe: (value: string) => {
        serve = value;
      },
    };
  }
  const commands = (calls: { args: string[] }[]) =>
    calls.map((c) => c.args.join(' ')).filter((a) => !a.endsWith('status --json'));

  it('richtet die Freigabe mit serve --bg --yes 3000 ein und prüft das Ergebnis', async () => {
    const { service, calls } = stateful();
    const outcome = await service.setupServe();
    expect(outcome).toMatchObject({
      ok: true,
      inspection: { servePort: 443, address: `https://${DNS}` },
    });
    expect(commands(calls)).toEqual(['serve --bg --yes 3000']);
    expect(calls.find((c) => c.args[0] === 'serve' && c.args.includes('--bg'))?.file).toBe(
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    );
  });

  it('ist idempotent: eine vorhandene eigene Freigabe wird nicht noch einmal gesetzt', async () => {
    const { service, calls } = stateful({ serve: serveJson() });
    expect(await service.setupServe()).toMatchObject({ ok: true });
    expect(commands(calls)).toEqual([]);
  });

  it('überschreibt nie eine fremde Freigabe auf 443, sondern verweigert und schlägt den Ausweichport vor', async () => {
    const { service, calls } = stateful({ serve: serveJson({ target: 'http://127.0.0.1:9999' }) });
    expect(await service.setupServe({ httpsPort: 443 })).toEqual({ ok: false, reason: 'foreign' });
    expect(commands(calls)).toEqual([]);
    // Mit Ausweichport (auf Wunsch): 8443, die fremde Freigabe bleibt.
    const outcome = await service.setupServe({ httpsPort: 8443 });
    expect(outcome).toMatchObject({
      ok: true,
      inspection: { servePort: 8443, address: `https://${DNS}:8443` },
    });
    expect(commands(calls)).toEqual(['serve --bg --yes --https=8443 3000']);
  });

  it('nimmt ohne Angabe bei belegter 443 den ersten freien Port', async () => {
    const { service, calls } = stateful({ serve: serveJson({ target: 'http://127.0.0.1:9999' }) });
    expect(await service.setupServe()).toMatchObject({ ok: true });
    expect(commands(calls)).toEqual(['serve --bg --yes --https=8443 3000']);
  });

  it('lehnt unzulässige Ports und volle Belegung ab', async () => {
    const { service } = stateful();
    expect(await service.setupServe({ httpsPort: 4444 })).toEqual({ ok: false, reason: 'no-port' });
    const all = JSON.stringify({
      Web: Object.fromEntries(
        [443, 8443, 10000].map((p) => [
          `${DNS}:${p}`,
          { Handlers: { '/': { Proxy: 'http://127.0.0.1:9' } } },
        ]),
      ),
    });
    expect(await stateful({ serve: all }).service.setupServe()).toEqual({
      ok: false,
      reason: 'no-port',
    });
  });

  it('richtet nichts ein, solange Tailscale nicht läuft oder HTTPS aus ist', async () => {
    for (const status of [
      statusJson({ BackendState: 'Stopped' }),
      statusJson({ CertDomains: [] }),
      statusJson({ BackendState: 'NeedsLogin' }),
    ]) {
      const { service, calls } = stateful({ status });
      expect(await service.setupServe()).toEqual({ ok: false, reason: 'not-running' });
      expect(commands(calls)).toEqual([]);
    }
  });

  it('meldet Fehler des Befehls und Zeitüberschreitungen als Codes, ohne Text von Tailscale', async () => {
    const failing = fakeExec({
      onCommand: () => ({
        code: 1,
        stderr: 'Geheimer Text von Tailscale https://login.example.test/x',
      }),
    });
    const s1 = new TailscaleService({
      exec: failing.exec,
      localPort: 3000,
      exists: () => true,
      pathEnv: '',
    });
    const outcome = await s1.setupServe();
    expect(outcome).toEqual({ ok: false, reason: 'command-failed' });
    expect(JSON.stringify(outcome)).not.toContain('Geheimer');

    const slow = fakeExec({ onCommand: () => ({ timedOut: true, code: null }) });
    const s2 = new TailscaleService({
      exec: slow.exec,
      localPort: 3000,
      exists: () => true,
      pathEnv: '',
    });
    expect(await s2.setupServe()).toEqual({ ok: false, reason: 'timeout' });

    const silent = fakeExec({});
    const s3 = new TailscaleService({
      exec: silent.exec,
      localPort: 3000,
      exists: () => true,
      pathEnv: '',
    });
    // Der Befehl meldet Erfolg, die Freigabe steht danach aber nicht: Prüfung schlägt an.
    expect(await s3.setupServe()).toEqual({ ok: false, reason: 'verify-failed' });
  });

  it('serve reset nimmt alle Freigaben weg', async () => {
    const { service, calls } = stateful({ serve: serveJson({ funnel: true }) });
    const outcome = await service.resetServe();
    expect(outcome).toMatchObject({ ok: true, inspection: { funnel: false, servePort: null } });
    expect(commands(calls)).toEqual(['serve reset']);
  });

  it('benennt den Rechner um, nur mit gültigem Namen', async () => {
    const { service, calls } = stateful();
    expect(await service.renameHost('pagewise-mac')).toMatchObject({ ok: true });
    expect(commands(calls)).toEqual(['set --hostname=pagewise-mac']);
    for (const bad of ['', 'Kay Mac', '--advertise-exit-node', 'a;b', 'ä']) {
      expect(await service.renameHost(bad), JSON.stringify(bad)).toEqual({
        ok: false,
        reason: 'invalid-name',
      });
    }
    expect(commands(calls)).toEqual(['set --hostname=pagewise-mac']);
  });

  it('ruft nie funnel auf und nie mit einer Shell', async () => {
    const { service, calls } = stateful();
    await service.setupServe();
    await service.resetServe();
    await service.renameHost('pagewise-mac');
    for (const call of calls) {
      expect(call.args).not.toContain('funnel');
      expect(call.file).not.toMatch(/sh$|bash|zsh/);
      for (const arg of call.args) expect(arg).not.toMatch(/[;&|`$<>\n]/);
    }
  });

  it('führt Aktionen nicht gleichzeitig aus', async () => {
    const { service } = stateful();
    const [first, second] = await Promise.all([service.setupServe(), service.setupServe()]);
    const results = [first, second];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results).toContainEqual({ ok: false, reason: 'busy' });
  });
});
