import { describe, expect, it } from 'vitest';
import { generateSetupCode, normalizeSetupCode, setupCodeMatches } from './setup-code';

describe('Einrichtungscode', () => {
  it('hat das Format XXXXX-XXXXX ohne verwechselbare Zeichen', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = generateSetupCode();
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
      seen.add(code);
    }
    expect(seen.size).toBe(200);
  });

  it('nimmt Eingaben mit Kleinschreibung, Leerzeichen und fehlendem Bindestrich an', () => {
    expect(normalizeSetupCode(' k7m2p x9qra ')).toBe('K7M2PX9QRA');
    expect(setupCodeMatches('K7M2P-X9QRA', 'k7m2p-x9qra')).toBe(true);
    expect(setupCodeMatches('K7M2P-X9QRA', 'K7M2PX9QRA')).toBe(true);
  });

  it('lehnt falsche, zu kurze und zu lange Eingaben ab', () => {
    expect(setupCodeMatches('K7M2P-X9QRA', 'K7M2P-X9QRB')).toBe(false);
    expect(setupCodeMatches('K7M2P-X9QRA', 'K7M2P')).toBe(false);
    expect(setupCodeMatches('K7M2P-X9QRA', 'K7M2P-X9QRAA')).toBe(false);
    expect(setupCodeMatches('K7M2P-X9QRA', '')).toBe(false);
  });
});
