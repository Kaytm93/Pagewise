import { describe, expect, it, vi } from 'vitest';
import { ConnectController, type ConnectDeps } from './connect-controller';
import { DNS, EMPTY_SERVE, fakeExec, serveJson, statusJson } from './tailscale/fixtures';
import { TailscaleService } from './tailscale/service';

/** Ein Controller mit echtem Tailscale-Dienst über einem Ersatz für `execFile` und Ersatz für alles Native. */
function setup(options: { status?: string; serve?: string; confirm?: boolean } = {}) {
  let serve = options.serve ?? EMPTY_SERVE;
  const fake = fakeExec({
    statusOutput: () => options.status ?? statusJson(),
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
  const copied: string[] = [];
  const opened: string[] = [];
  const paths: string[] = [];
  const remembered: boolean[] = [];
  const confirms: Array<{ title: string; detail: string }> = [];
  const changes: Array<string | null> = [];
  const deps: ConnectDeps = {
    tailscale: new TailscaleService({
      exec: fake.exec,
      localPort: 3000,
      exists: () => true,
      pathEnv: '',
    }),
    confirm: async (request) => {
      confirms.push(request);
      return options.confirm ?? true;
    },
    copy: (text) => copied.push(text),
    openExternal: (url) => opened.push(url),
    openPath: (path) => paths.push(path),
    keepAwake: () => true,
    rememberServe: (enabled) => remembered.push(enabled),
    changed: (inspection) => changes.push(inspection.address),
    urls: {
      download: 'https://download.example.test',
      adminDns: 'https://admin.example.test/dns',
      adminMachines: 'https://admin.example.test/machines',
      appPath: '/Applications/Tailscale.app',
    },
  };
  return {
    controller: new ConnectController(deps),
    fake,
    copied,
    opened,
    paths,
    remembered,
    confirms,
    changes,
  };
}

const commands = (calls: { args: string[] }[]) =>
  calls.map((c) => c.args.join(' ')).filter((a) => !a.endsWith('status --json'));

describe('ConnectController', () => {
  it('richtet die Freigabe ein, merkt es sich und zeigt danach die Adresse samt QR-Code', async () => {
    const { controller, fake, remembered, changes } = setup();
    const view = await controller.setupServe(false);
    expect(view.stage).toBe('served');
    expect(view.address).toBe(`https://${DNS}`);
    expect(view.qr).not.toBeNull();
    expect(view.message).toBe('Erledigt.');
    expect(remembered).toEqual([true]);
    expect(changes.at(-1)).toBe(`https://${DNS}`);
    expect(commands(fake.calls)).toEqual(['serve --bg --yes 3000']);
  });

  it('fragt bei personenbezogenem Rechnernamen vorher nach und bricht bei „Nein“ ab, ohne etwas zu ändern', async () => {
    const personal = statusJson({
      Self: { HostName: 'Kays-MacBook-Pro', DNSName: 'kays-macbook-pro.tail0000.ts.net.' },
      CertDomains: ['kays-macbook-pro.tail0000.ts.net'],
    });
    const declined = setup({ status: personal, confirm: false });
    const view = await declined.controller.setupServe(false);
    expect(declined.confirms).toHaveLength(1);
    expect(declined.confirms[0]?.detail).toContain('kays-macbook-pro');
    expect(declined.confirms[0]?.detail).toContain('öffentlich');
    expect(view.message).toBe('Abgebrochen.');
    expect(commands(declined.fake.calls)).toEqual([]);
    expect(declined.remembered).toEqual([]);

    const accepted = setup({ status: personal, confirm: true });
    expect((await accepted.controller.setupServe(false)).message).toBe('Erledigt.');
  });

  it('nutzt den Ausweichport nur auf ausdrücklichen Wunsch und lässt die fremde Freigabe stehen', async () => {
    const { controller, fake } = setup({ serve: serveJson({ target: 'http://127.0.0.1:9999' }) });
    const before = await controller.getView();
    expect(before.warnings[0]?.id).toBe('foreign');
    expect(before.actions.map((a) => a.id)).toContain('use-alt-port');
    const view = await controller.setupServe(true);
    expect(view.address).toBe(`https://${DNS}:8443`);
    expect(commands(fake.calls)).toEqual(['serve --bg --yes --https=8443 3000']);
  });

  it('setzt die Freigabe nur nach Bestätigung zurück und vergisst dann die Einrichtung', async () => {
    const no = setup({ serve: serveJson({ funnel: true }), confirm: false });
    expect((await no.controller.resetServe()).message).toBe('Abgebrochen.');
    expect(commands(no.fake.calls)).toEqual([]);
    expect(no.confirms[0]?.detail).toContain('alle Freigaben');

    const yes = setup({ serve: serveJson({ funnel: true }), confirm: true });
    const view = await yes.controller.resetServe();
    expect(view.warnings.map((w) => w.id)).not.toContain('funnel');
    expect(commands(yes.fake.calls)).toEqual(['serve reset']);
    expect(yes.remembered).toEqual([false]);
  });

  it('benennt den Rechner nur mit gültigem Namen und nach Erklärung der Folgen um', async () => {
    const { controller, fake, confirms } = setup();
    expect((await controller.renameHost('Kay Mac')).message).toContain('Kleinbuchstaben');
    expect((await controller.renameHost(42)).message).toContain('Kleinbuchstaben');
    expect((await controller.renameHost('--accept-routes')).message).toContain('Kleinbuchstaben');
    expect(commands(fake.calls)).toEqual([]);
    expect(confirms).toEqual([]);

    const view = await controller.renameHost('pagewise-mac');
    expect(view.message).toBe('Erledigt.');
    expect(confirms[0]?.detail).toContain('Adresse');
    expect(confirms[0]?.detail).toContain('iOS-App');
    expect(commands(fake.calls)).toEqual(['set --hostname=pagewise-mac']);
  });

  it('kopiert nur die geprüfte Adresse aus dem Zustand, nie etwas von der Seite', async () => {
    const withServe = setup({ serve: serveJson() });
    const view = await withServe.controller.copyAddress();
    expect(withServe.copied).toEqual([`https://${DNS}`]);
    expect(view.message).toBe('Adresse kopiert.');
    const without = setup();
    await without.controller.copyAddress();
    expect(without.copied).toEqual([]);
  });

  it('öffnet nur feste Adressen und die App von Tailscale', () => {
    const { controller, opened, paths } = setup();
    controller.openDownload();
    controller.openAdmin('dns');
    controller.openAdmin('machines');
    controller.openTailscale();
    expect(opened).toEqual([
      'https://download.example.test',
      'https://admin.example.test/dns',
      'https://admin.example.test/machines',
    ]);
    expect(paths).toEqual(['/Applications/Tailscale.app']);
  });

  it('meldet Fehler als Text der App, ohne Text von Tailscale', async () => {
    const fake = fakeExec({ onCommand: () => ({ code: 1, stderr: 'GEHEIM aus Tailscale' }) });
    const changed = vi.fn();
    const controller = new ConnectController({
      tailscale: new TailscaleService({
        exec: fake.exec,
        localPort: 3000,
        exists: () => true,
        pathEnv: '',
      }),
      confirm: async () => true,
      copy: () => {},
      openExternal: () => {},
      openPath: () => {},
      keepAwake: () => true,
      rememberServe: () => {},
      changed,
      urls: { download: 'x', adminDns: 'x', adminMachines: 'x', appPath: 'x' },
    });
    const view = await controller.setupServe(false);
    expect(view.message).toContain('Tailscale hat den Befehl abgelehnt');
    expect(JSON.stringify(view)).not.toContain('GEHEIM');
  });
});
