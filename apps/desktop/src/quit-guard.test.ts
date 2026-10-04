import { describe, expect, it } from 'vitest';
import { describeQuit } from './quit-guard';

describe('Beenden', () => {
  it('fragt nicht nach, wenn niemand angemeldet ist und nichts läuft (oder der Server nicht antwortet)', () => {
    expect(describeQuit({ activeChats: 0, sessions: 0 }).needsConfirm).toBe(false);
    expect(describeQuit(null).needsConfirm).toBe(false);
  });

  it('warnt vor laufenden Antworten', () => {
    const one = describeQuit({ activeChats: 1, sessions: 0 });
    expect(one.needsConfirm).toBe(true);
    expect(one.detail).toContain('Eine Antwort läuft noch');
    const many = describeQuit({ activeChats: 3, sessions: 0 });
    expect(many.detail).toContain('3 Antworten laufen noch');
  });

  it('warnt bei Anmeldungen und zählt Anmeldungen, nicht Geräte', () => {
    const status = describeQuit({ activeChats: 0, sessions: 2 });
    expect(status.needsConfirm).toBe(true);
    expect(status.detail).toContain('Angemeldet: 2');
    expect(status.detail).not.toContain('Geräte angemeldet');
  });

  it('erklärt immer, dass iPhone und iPad dann nichts erreichen, und nennt Cmd+W', () => {
    const { detail } = describeQuit({ activeChats: 1, sessions: 1 });
    expect(detail).toContain('iPhone und iPad');
    expect(detail).toContain('Cmd+W');
  });
});
