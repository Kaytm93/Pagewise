import { describe, expect, it } from 'vitest';
import { KeepAwake, type PowerSaveBlockerLike, wakeReason } from './keep-awake';

class FakeBlocker implements PowerSaveBlockerLike {
  started = new Map<number, string>();
  starts = 0;
  stops = 0;
  private next = 1;
  start(type: 'prevent-app-suspension' | 'prevent-display-sleep'): number {
    const id = this.next++;
    this.started.set(id, type);
    this.starts += 1;
    return id;
  }
  stop(id: number): void {
    this.started.delete(id);
    this.stops += 1;
  }
  isStarted(id: number): boolean {
    return this.started.has(id);
  }
}

describe('Wachregel', () => {
  it('ist an, solange Antworten laufen, sonst folgt sie dem Schalter', () => {
    expect(wakeReason({ userEnabled: false, activeChats: 0 })).toBeNull();
    expect(wakeReason({ userEnabled: true, activeChats: 0 })).toBe('user');
    expect(wakeReason({ userEnabled: false, activeChats: 1 })).toBe('answers');
    expect(wakeReason({ userEnabled: true, activeChats: 3 })).toBe('answers');
  });
});

describe('KeepAwake', () => {
  it('nutzt prevent-app-suspension, nie prevent-display-sleep (das Display darf ausgehen)', () => {
    const blocker = new FakeBlocker();
    const awake = new KeepAwake(blocker);
    awake.update({ userEnabled: true, activeChats: 0 });
    expect([...blocker.started.values()]).toEqual(['prevent-app-suspension']);
  });

  it('startet einmal und stoppt einmal, auch bei vielen gleichen Aufrufen', () => {
    const blocker = new FakeBlocker();
    const awake = new KeepAwake(blocker);
    for (let i = 0; i < 5; i += 1) awake.update({ userEnabled: true, activeChats: 0 });
    expect(blocker.starts).toBe(1);
    expect(awake.active).toBe(true);
    for (let i = 0; i < 5; i += 1) awake.update({ userEnabled: false, activeChats: 0 });
    expect(blocker.stops).toBe(1);
    expect(awake.active).toBe(false);
    expect(awake.reason).toBeNull();
  });

  it('schaltet sich während laufender Antworten auch bei ausgeschaltetem Schalter ein und danach wieder aus', () => {
    const blocker = new FakeBlocker();
    const awake = new KeepAwake(blocker);
    expect(awake.update({ userEnabled: false, activeChats: 0 })).toBeNull();
    expect(awake.update({ userEnabled: false, activeChats: 2 })).toBe('answers');
    expect(awake.active).toBe(true);
    expect(awake.update({ userEnabled: false, activeChats: 0 })).toBeNull();
    expect(awake.active).toBe(false);
  });

  it('startet neu, wenn das System die Zusicherung beendet hat', () => {
    const blocker = new FakeBlocker();
    const awake = new KeepAwake(blocker);
    awake.update({ userEnabled: true, activeChats: 0 });
    blocker.started.clear();
    awake.update({ userEnabled: true, activeChats: 0 });
    expect(blocker.starts).toBe(2);
  });

  it('gibt beim Beenden alles frei', () => {
    const blocker = new FakeBlocker();
    const awake = new KeepAwake(blocker);
    awake.update({ userEnabled: true, activeChats: 0 });
    awake.dispose();
    expect(blocker.started.size).toBe(0);
    expect(awake.active).toBe(false);
  });
});
