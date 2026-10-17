import { describe, expect, it } from 'vitest';
import { EMPTY_BUILD_INFO, parseBuildInfo, parseBuildInfoText, shortCommit } from './build-info';

const SHA = 'c'.repeat(40);

describe('build-info.json', () => {
  it('liest eine vollständige Datei', () => {
    const info = parseBuildInfo({
      commit: SHA,
      commitDate: '2026-10-17T10:00:00+02:00',
      builtAt: '2026-10-17T10:05:00.000Z',
      dirty: true,
      arch: 'arm64',
      toolchain: {
        node: '/opt/node/bin/node',
        pnpm: '/opt/pnpm/pnpm.cjs',
        path: ['/opt/node/bin', '/usr/bin'],
      },
    });
    expect(info).toEqual({
      commit: SHA,
      commitDate: '2026-10-17T10:00:00+02:00',
      builtAt: '2026-10-17T10:05:00.000Z',
      dirty: true,
      arch: 'arm64',
      toolchain: {
        node: '/opt/node/bin/node',
        pnpm: '/opt/pnpm/pnpm.cjs',
        path: ['/opt/node/bin', '/usr/bin'],
      },
    });
  });

  it('verwirft alles Ungültige einzeln, statt abzustürzen', () => {
    expect(
      parseBuildInfo({
        commit: 'kein-hash',
        commitDate: 'gestern',
        builtAt: 5,
        dirty: 'ja',
        arch: 'ppc',
        toolchain: { node: 'relativ/node', pnpm: 7, path: ['/ok', 'relativ', '/mit\nzeile', 3] },
      }),
    ).toEqual({ ...EMPTY_BUILD_INFO });
    expect(
      parseBuildInfo({ toolchain: { node: '/n/node', path: ['/ok', 'relativ', '/mit\nzeile', 3] } })
        .toolchain,
    ).toEqual({ node: '/n/node', pnpm: null, path: ['/ok'] });
  });

  it('gibt bei kaputtem oder fehlendem Inhalt die leere Fassung zurück', () => {
    for (const text of [null, '', 'kein json', '[1,2]', 'null', '"x"']) {
      expect(parseBuildInfoText(text), String(text)).toEqual({ ...EMPTY_BUILD_INFO });
    }
  });

  it('kürzt den Hash für die Anzeige', () => {
    expect(shortCommit(SHA)).toBe('ccccccc');
    expect(shortCommit(null)).toBeNull();
  });
});
