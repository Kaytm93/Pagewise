import { describe, expect, it } from 'vitest';
import { AttemptLimiter } from './attempt-limiter';

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('AttemptLimiter', () => {
  it('erlaubt Versuche, bis die Höchstzahl an Fehlversuchen erreicht ist', () => {
    const limiter = new AttemptLimiter({ maxFailures: 3 });
    for (let i = 0; i < 3; i++) {
      expect(limiter.check()).toEqual({ allowed: true });
      limiter.recordFailure();
    }
    expect(limiter.check().allowed).toBe(false);
  });

  it('nennt, wie lange die Sperre noch dauert', () => {
    const time = clock();
    const limiter = new AttemptLimiter({ maxFailures: 2, windowMs: 60_000, now: time.now });
    limiter.recordFailure();
    time.advance(10_000);
    limiter.recordFailure();
    expect(limiter.check()).toEqual({ allowed: false, retryAfterSeconds: 50 });
    time.advance(20_000);
    expect(limiter.check()).toEqual({ allowed: false, retryAfterSeconds: 30 });
  });

  it('gibt Versuche wieder frei, sobald der älteste Fehlversuch aus dem Fenster fällt', () => {
    const time = clock();
    const limiter = new AttemptLimiter({ maxFailures: 2, windowMs: 60_000, now: time.now });
    limiter.recordFailure();
    time.advance(30_000);
    limiter.recordFailure();
    expect(limiter.check().allowed).toBe(false);
    time.advance(30_001);
    expect(limiter.check().allowed).toBe(true);
  });

  it('beginnt nach reset() von vorn', () => {
    const limiter = new AttemptLimiter({ maxFailures: 1 });
    limiter.recordFailure();
    expect(limiter.check().allowed).toBe(false);
    limiter.reset();
    expect(limiter.check().allowed).toBe(true);
  });

  it('meldet mindestens eine Sekunde', () => {
    const time = clock();
    const limiter = new AttemptLimiter({ maxFailures: 1, windowMs: 1000, now: time.now });
    limiter.recordFailure();
    time.advance(999);
    expect(limiter.check()).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });
});
