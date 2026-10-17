import { describe, expect, it } from 'vitest';
import type { BuildInfo } from './build-info';
import { MemoryFs } from './test-support';
import { nvmBinDirs, resolveTools } from './tools';

const HOME = '/Users/beispiel';
const NVM = `${HOME}/.nvm/versions/node`;
const info = (toolchain: BuildInfo['toolchain']): BuildInfo => ({
  commit: null,
  commitDate: null,
  builtAt: null,
  dirty: false,
  arch: null,
  toolchain,
});

function base(): MemoryFs {
  return new MemoryFs().addExecutable('/usr/bin/git');
}

describe('Werkzeuge für das Update', () => {
  it('bevorzugt den Stand des Bauens', () => {
    const fs = base()
      .addExecutable(`${NVM}/v22.1.0/bin/node`)
      .addFile(`${NVM}/v22.1.0/lib/pnpm.cjs`);
    const result = resolveTools({
      info: info({
        node: `${NVM}/v22.1.0/bin/node`,
        pnpm: `${NVM}/v22.1.0/lib/pnpm.cjs`,
        path: ['/x/bin'],
      }),
      home: HOME,
      fs,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tools.remembered).toBe(true);
    expect(result.tools.node).toBe(`${NVM}/v22.1.0/bin/node`);
    expect(result.tools.pnpm).toEqual({
      command: `${NVM}/v22.1.0/bin/node`,
      prefix: [`${NVM}/v22.1.0/lib/pnpm.cjs`],
    });
    expect(result.tools.pathDirs[0]).toBe(`${NVM}/v22.1.0/bin`);
    expect(result.tools.pathDirs).toContain('/x/bin');
  });

  it('startet ein pnpm-Programm direkt und nimmt seinen Ordner in den PATH', () => {
    const fs = base()
      .addExecutable('/opt/homebrew/bin/node')
      .addExecutable('/opt/homebrew/bin/pnpm');
    const result = resolveTools({
      info: info({ node: '/opt/homebrew/bin/node', pnpm: '/opt/homebrew/bin/pnpm', path: [] }),
      home: HOME,
      fs,
    });
    expect(result.ok && result.tools.pnpm).toEqual({
      command: '/opt/homebrew/bin/pnpm',
      prefix: [],
    });
  });

  it('sucht neu, wenn der gemerkte Node nicht mehr da ist (nvm gewechselt), und nimmt die neueste Version', () => {
    const fs = base()
      .addExecutable(`${NVM}/v22.9.0/bin/node`)
      .addExecutable(`${NVM}/v24.1.0/bin/node`)
      .addExecutable(`${NVM}/v24.1.0/bin/pnpm`)
      .addDir(`${NVM}/v10.0.0`);
    const result = resolveTools({
      info: info({
        node: `${NVM}/v20.0.0/bin/node`,
        pnpm: `${NVM}/v20.0.0/lib/pnpm.cjs`,
        path: [],
      }),
      home: HOME,
      fs,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tools.remembered).toBe(false);
    expect(result.tools.node).toBe(`${NVM}/v24.1.0/bin/node`);
    expect(result.tools.pnpm.command).toBe(`${NVM}/v24.1.0/bin/pnpm`);
  });

  it('findet Werkzeuge ohne gemerkten Stand an üblichen Orten', () => {
    const fs = base()
      .addExecutable('/opt/homebrew/bin/node')
      .addExecutable(`${HOME}/Library/pnpm/pnpm`);
    const result = resolveTools({ info: info(null), home: HOME, fs });
    expect(result.ok && result.tools.node).toBe('/opt/homebrew/bin/node');
    expect(result.ok && result.tools.pnpm.command).toBe(`${HOME}/Library/pnpm/pnpm`);
  });

  it('meldet fehlendes git, Node und pnpm getrennt', () => {
    expect(resolveTools({ info: info(null), home: HOME, fs: new MemoryFs() })).toMatchObject({
      ok: false,
      code: 'no-git',
    });
    expect(resolveTools({ info: info(null), home: HOME, fs: base() })).toMatchObject({
      ok: false,
      code: 'no-tools',
      detail: 'node nicht gefunden',
    });
    expect(
      resolveTools({
        info: info(null),
        home: HOME,
        fs: base().addExecutable('/opt/homebrew/bin/node'),
      }),
    ).toMatchObject({ ok: false, code: 'no-tools', detail: 'pnpm nicht gefunden' });
  });

  it('sortiert nvm-Versionen nach Zahlen, nicht nach Text', () => {
    const fs = new MemoryFs()
      .addDir(`${NVM}/v9.0.0`)
      .addDir(`${NVM}/v22.10.1`)
      .addDir(`${NVM}/v22.9.0`)
      .addDir(`${NVM}/zufall`);
    expect(nvmBinDirs(HOME, fs)).toEqual([
      `${NVM}/v22.10.1/bin`,
      `${NVM}/v22.9.0/bin`,
      `${NVM}/v9.0.0/bin`,
    ]);
  });
});
