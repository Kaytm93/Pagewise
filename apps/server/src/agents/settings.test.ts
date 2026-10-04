import { describe, expect, it } from 'vitest';
import { absRule, buildAgentSettings, toolReadDirs, UnsafePathError } from './settings';

const ws =
  '/Users/beispiel/Library/Application Support/Pagewise/workspaces/11111111-1111-4111-8111-111111111111/main';
const data = '/Users/beispiel/Library/Application Support/Pagewise';

describe('buildAgentSettings', () => {
  const settings = buildAgentSettings({
    workspace: ws,
    realHome: '/Users/beispiel',
    dataRoot: data,
    searchPath: '/usr/bin:/Users/beispiel/.nvm/versions/node/v22/bin:/opt/homebrew/bin',
  });

  it('erlaubt Schreiben nur im Arbeitsordner, mit absoluter Regel', () => {
    expect(settings.permissions.allow).toEqual([`Edit(//${ws.slice(1)}/**)`]);
    expect(settings.permissions.allow.every((rule) => !rule.includes('./'))).toBe(true);
  });

  it('schützt Einstellungen, Projekt-Anweisungen und Werkzeug-Server im Arbeitsordner', () => {
    expect(settings.permissions.deny).toEqual([
      `Edit(//${ws.slice(1)}/.claude/**)`,
      `Edit(//${ws.slice(1)}/CLAUDE.md)`,
      `Edit(//${ws.slice(1)}/.mcp.json)`,
    ]);
  });

  it('schaltet die Sandbox streng ein: ohne Rückfall, ohne Netz', () => {
    expect(settings.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
      network: { allowedDomains: [] },
    });
  });

  it('sperrt Benutzerverzeichnis, Datenverzeichnis und andere Orte für Befehle, außer dem Arbeitsordner', () => {
    const { denyRead, allowRead } = settings.sandbox.filesystem;
    for (const path of ['/Users/beispiel', data, '/Users', '/home', '/Volumes', '/mnt', '/media']) {
      expect(denyRead).toContain(absRule(path));
    }
    expect(allowRead[0]).toBe(absRule(ws));
  });

  it('lässt Werkzeuge im Benutzerverzeichnis lesbar (PATH-Ordner und ihr Elternordner)', () => {
    const { allowRead } = settings.sandbox.filesystem;
    expect(allowRead).toContain(absRule('/Users/beispiel/.nvm/versions/node/v22/bin'));
    expect(allowRead).toContain(absRule('/Users/beispiel/.nvm/versions/node/v22'));
    expect(allowRead).not.toContain(absRule('/usr/bin'));
    expect(allowRead).not.toContain(absRule('/Users/beispiel'));
  });

  it.each([
    ['/Users/beispiel/ws*'],
    ['/Users/beispiel/[x]'],
    ['/Users/beispiel/{a,b}'],
    ['relativ/pfad'],
  ])('lehnt den Arbeitsordner %s ab, statt ihn als Muster zu deuten', (workspace) => {
    expect(() =>
      buildAgentSettings({ workspace, realHome: '/Users/beispiel', dataRoot: data }),
    ).toThrow(UnsafePathError);
  });
});

describe('toolReadDirs', () => {
  it('nimmt nur Ordner im Benutzerverzeichnis und keine mit Mustern', () => {
    expect(
      toolReadDirs(
        '/usr/bin:/Users/beispiel/bin:/Users/beispiel/x*/bin:/Users/anderer/bin',
        '/Users/beispiel',
      ),
    ).toEqual(['/Users/beispiel/bin']);
  });
});
