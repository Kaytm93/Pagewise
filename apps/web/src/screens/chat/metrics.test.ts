import { describe, expect, it } from 'vitest';
import { formatCost, metricsLine } from './metrics';

/** Intl setzt ein geschütztes Leerzeichen zwischen Zahl und Währung; für den Vergleich normal machen. */
const plain = (text: string | null) => (text ?? '').replace(/ /g, ' ');

describe('formatCost', () => {
  it('zeigt Dollar auf Deutsch mit zwei gültigen Stellen', () => {
    expect(plain(formatCost(0.00115))).toBe('0,0012 $');
  });
});

describe('metricsLine', () => {
  it('zeigt Tempo und Kosten, wenn beides bekannt ist', () => {
    expect(plain(metricsLine({ tokensPerSecond: 84.25, costUsd: 0.00115 }))).toBe(
      '84,3 Token/s · ≈ 0,0012 $',
    );
  });

  it('zeigt nur, was bekannt ist', () => {
    expect(metricsLine({ tokensPerSecond: 40, costUsd: null })).toBe('40 Token/s');
    expect(plain(metricsLine({ tokensPerSecond: null, costUsd: 0.5 }))).toMatch(/^≈ 0,5/);
  });

  it('zeigt nichts, wenn nichts bekannt ist (freie Modelle, Pläne, lokale Anbieter)', () => {
    expect(metricsLine({ tokensPerSecond: null, costUsd: null })).toBeNull();
  });
});
