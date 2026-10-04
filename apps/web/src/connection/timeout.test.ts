import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOAD_TIMEOUT_MS, TimeoutError, withTimeout } from './timeout';

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('liefert das Ergebnis, wenn es rechtzeitig kommt, und räumt den Zeitgeber ab', async () => {
    const result = withTimeout(Promise.resolve('ok'), 1_000);
    await expect(result).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reicht Fehler der Anfrage unverändert weiter', async () => {
    const failure = new Error('kaputt');
    await expect(withTimeout(Promise.reject(failure), 1_000)).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('wirft nach der Zeit einen TimeoutError und ignoriert das späte Ergebnis', async () => {
    let resolve: (value: string) => void = () => {};
    const slow = new Promise<string>((r) => {
      resolve = r;
    });
    const result = withTimeout(slow, LOAD_TIMEOUT_MS);
    const outcome = result.then(
      () => 'ok',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBeInstanceOf(TimeoutError);
    resolve('zu spät');
  });
});
