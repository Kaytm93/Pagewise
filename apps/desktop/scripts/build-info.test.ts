import { describe, expect, it } from 'vitest';
import { parseBuildInfo } from '../src/update/build-info';
import { type BuildInfoSources, collectBuildInfo } from './build-info';

const SHA = 'd'.repeat(40);

function sources(overrides: Partial<BuildInfoSources> = {}, status = ''): BuildInfoSources {
  return {
    git: (args) => {
      if (args[0] === 'rev-parse') return `${SHA}\n`;
      if (args[0] === 'show') return '2026-10-17T10:00:00+02:00\n';
      if (args[0] === 'status') return status;
      return null;
    },
    env: {
      npm_node_execpath: '/Users/beispiel/.nvm/versions/node/v22.1.0/bin/node',
      npm_execpath: '/Users/beispiel/.nvm/versions/node/v22.1.0/lib/node_modules/pnpm/bin/pnpm.cjs',
      PATH: '/Users/beispiel/Pagewise/node_modules/.bin:/Users/beispiel/.nvm/versions/node/v22.1.0/bin:relativ:/usr/bin',
    },
    execPath: '/usr/local/bin/node',
    arch: 'arm64',
    now: new Date('2026-10-17T10:05:00Z'),
    ...overrides,
  };
}

describe('build-info.json beim Bauen', () => {
  it('hält Commit, Zeitpunkte und die Werkzeuge des Terminals fest', () => {
    const info = collectBuildInfo(sources());
    expect(info).toEqual({
      commit: SHA,
      commitDate: '2026-10-17T10:00:00+02:00',
      builtAt: '2026-10-17T10:05:00.000Z',
      dirty: false,
      arch: 'arm64',
      toolchain: {
        node: '/Users/beispiel/.nvm/versions/node/v22.1.0/bin/node',
        pnpm: '/Users/beispiel/.nvm/versions/node/v22.1.0/lib/node_modules/pnpm/bin/pnpm.cjs',
        // Ordner mit node_modules gehören zum Repository, relative Einträge sind wertlos.
        path: ['/Users/beispiel/.nvm/versions/node/v22.1.0/bin', '/usr/bin'],
      },
    });
    // Was hineingeschrieben wird, liest die App ohne Verlust wieder ein.
    expect(parseBuildInfo(JSON.parse(JSON.stringify(info)))).toEqual(info);
  });

  it('erkennt lokale Änderungen an verfolgten Dateien', () => {
    expect(collectBuildInfo(sources({}, ' M apps/web/src/App.tsx\n')).dirty).toBe(true);
    expect(collectBuildInfo(sources({}, '')).dirty).toBe(false);
  });

  it('kommt ohne git und ohne pnpm klar (Quelltext als Archiv, direkter Aufruf)', () => {
    const info = collectBuildInfo(
      sources({ git: () => null, env: {}, execPath: '/opt/node/bin/node' }),
    );
    expect(info.commit).toBeNull();
    expect(info.commitDate).toBeNull();
    expect(info.dirty).toBe(false);
    expect(info.toolchain).toEqual({ node: '/opt/node/bin/node', pnpm: null, path: [] });
  });

  it('merkt sich nur ein pnpm, das auch eines ist (npm_execpath kann npm oder yarn sein)', () => {
    const info = collectBuildInfo(
      sources({ env: { npm_execpath: '/usr/local/lib/node_modules/npm/bin/npm-cli.js' } }),
    );
    expect(info.toolchain?.pnpm).toBeNull();
  });

  it('merkt sich nicht den vorläufigen Ordner, aus dem pnpm beim Wechsel der Fassung zuerst läuft', () => {
    const info = collectBuildInfo(
      sources({
        env: {
          npm_execpath:
            '/Users/beispiel/Library/pnpm/.tools/pnpm/10.28.0_tmp_1948_0/node_modules/pnpm/bin/pnpm.cjs',
          PATH: '/Users/beispiel/Library/pnpm/.tools/pnpm/10.28.0/bin:/usr/bin',
        },
      }),
    );
    expect(info.toolchain?.pnpm).toBeNull();
    // Der PATH enthält den dauerhaften Ordner, darin findet die App das Programm `pnpm`.
    expect(info.toolchain?.path).toContain('/Users/beispiel/Library/pnpm/.tools/pnpm/10.28.0/bin');
  });
});
