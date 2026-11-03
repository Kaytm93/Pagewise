import { describe, expect, it } from 'vitest';
import { buildSeatbeltProfile, seatbeltPath } from './profile';

describe('buildSeatbeltProfile', () => {
  const profile = buildSeatbeltProfile({
    workspace: '/data/workspaces/aaaa',
    readOnly: ['/opt/python', '/opt/venv'],
  });

  it('verbietet zuerst alles', () => {
    expect(profile.split('\n')[1]).toBe('(deny default)');
  });

  it('erlaubt Schreiben nur im Arbeitsordner und in /dev/null', () => {
    const writes = profile.split('\n').filter((line) => /file-write\*/.test(line));
    expect(writes).toEqual([
      '(allow file-write* (literal "/dev/null"))',
      '(allow file-read* file-write* (subpath "/data/workspaces/aaaa"))',
    ]);
  });

  it('erlaubt Lesen im Python und im Arbeitsordner', () => {
    expect(profile).toContain('(subpath "/opt/python")');
    expect(profile).toContain('(subpath "/opt/venv")');
  });

  it('erlaubt weder Netz noch fork noch das Benutzerverzeichnis', () => {
    expect(profile).not.toMatch(/network/);
    expect(profile).not.toMatch(/process-fork/);
    expect(profile).not.toMatch(/\/Users|\/Volumes|\/private\/tmp/);
  });
});

describe('seatbeltPath', () => {
  it('lehnt Pfade ab, die sich nicht sicher schreiben lassen', () => {
    for (const bad of [
      'relativ/pfad',
      '/mit"anfuehrung',
      '/mit\\rueckstrich',
      '/mit\nzeile',
      '/a\u0000b',
    ]) {
      expect(() => seatbeltPath(bad)).toThrow();
    }
  });

  it('nimmt Leerzeichen und Umlaute', () => {
    expect(seatbeltPath('/Library/Application Support/Pagewise')).toBe(
      '"/Library/Application Support/Pagewise"',
    );
    expect(seatbeltPath('/Daten/Übung')).toBe('"/Daten/Übung"');
  });

  it('bricht beim Bau des Profils ab statt unsicher zu schreiben', () => {
    expect(() =>
      buildSeatbeltProfile({ workspace: '/ws"; (allow default) ;"', readOnly: [] }),
    ).toThrow();
    expect(() =>
      buildSeatbeltProfile({ workspace: '/ws', readOnly: ['/x") (allow network*'] }),
    ).toThrow();
  });
});
