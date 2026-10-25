import { describe, expect, it } from 'vitest';
import { type Billing, replyCost } from './cost';

const openrouter: Billing = {
  preset: 'openrouter',
  model: 'z-ai/glm-5.3-flash',
  baseUrl: 'https://openrouter.ai/api/v1',
};
const zai: Billing = {
  preset: 'zai',
  model: 'glm-5.3-flash',
  baseUrl: 'https://api.z.ai/api/paas/v4',
};
/** 1.000 Eingabe- und 2.000 Ausgabetokens, ohne Meldung des Anbieters. */
const usage = { promptTokens: 1_000, completionTokens: 2_000, reported: null };

describe('replyCost', () => {
  it('übernimmt die vom Anbieter gemeldeten Kosten', () => {
    expect(replyCost(openrouter, { ...usage, reported: 0.0123 })).toBe(0.0123);
  });

  it('rechnet Z.ai nach der Preisliste je Million Tokens', () => {
    // 1.000 × 0,15 + 2.000 × 0,50 = 1.150 je Million Tokens, also 0,00115 US-Dollar.
    expect(replyCost(zai, usage)).toBeCloseTo(0.00115, 8);
  });

  it('zeigt keine Kosten bei kostenlosen Modellen', () => {
    expect(
      replyCost({ ...openrouter, model: 'openrouter/free' }, { ...usage, reported: 0.5 }),
    ).toBeNull();
    expect(
      replyCost({ ...openrouter, model: 'anbieter/modell:free' }, { ...usage, reported: 0.5 }),
    ).toBeNull();
  });

  it('zeigt keine Kosten beim Coding Plan und bei lokalen Anbietern', () => {
    const plan = { ...zai, baseUrl: 'https://api.z.ai/api/coding/paas/v4' };
    expect(replyCost(plan, usage)).toBeNull();
    const local: Billing = {
      preset: 'ollama',
      model: 'llama',
      baseUrl: 'http://localhost:11434/v1',
    };
    expect(replyCost(local, { ...usage, reported: 0.5 })).toBeNull();
  });

  it('zeigt eine Gebühr von null nicht und rechnet ohne bekannten Preis nichts', () => {
    expect(replyCost(openrouter, { ...usage, reported: 0 })).toBeNull();
    const custom: Billing = {
      preset: 'custom',
      model: 'unbekannt',
      baseUrl: 'https://beispiel.test/v1',
    };
    expect(replyCost(custom, usage)).toBeNull();
    expect(replyCost(zai, { ...usage, completionTokens: null })).toBeNull();
  });
});
