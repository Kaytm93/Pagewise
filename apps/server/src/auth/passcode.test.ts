import { describe, expect, it } from 'vitest';
import {
  checkPasscodeStrength,
  DEFAULT_SCRYPT_PARAMS,
  hashPasscode,
  PASSCODE_MAX_LENGTH,
  PASSCODE_MIN_LENGTH,
  verifyPasscode,
} from './passcode';

// Schwache Parameter, damit die Tests schnell bleiben. Die Standardwerte prüft ein eigener Test.
const fast = { N: 16, r: 8, p: 1 };
const phrase = 'ein erfundener Beispiel-Passcode';

describe('Passcode-Hash', () => {
  it('erkennt den richtigen und lehnt falsche Passcodes ab', async () => {
    const hash = await hashPasscode(phrase, fast);
    expect(await verifyPasscode(phrase, hash)).toBe(true);
    expect(await verifyPasscode(`${phrase}!`, hash)).toBe(false);
    expect(await verifyPasscode('', hash)).toBe(false);
  });

  it('nutzt für jeden Hash ein neues Salz und enthält den Passcode nicht', async () => {
    const a = await hashPasscode(phrase, fast);
    const b = await hashPasscode(phrase, fast);
    expect(a).not.toBe(b);
    expect(a).not.toContain(phrase);
    expect(a.split('$').slice(0, 4)).toEqual(['scrypt', '16', '8', '1']);
  });

  it('behandelt zusammengesetzte und getrennte Umlaute gleich (Unicode NFKC)', async () => {
    const composed = 'schönes Beispiel 123';
    const decomposed = 'schönes Beispiel 123';
    const hash = await hashPasscode(composed, fast);
    expect(await verifyPasscode(decomposed, hash)).toBe(true);
  });

  it.each([
    '',
    'kein hash',
    'scrypt$16$8$1$abc',
    'argon2id$16$8$1$c2FsdA==$aGFzaA==',
    `scrypt$${2 ** 21}$8$1$c2FsdA==$${Buffer.alloc(64).toString('base64')}`,
    `scrypt$17$8$1$c2FsdA==$${Buffer.alloc(64).toString('base64')}`,
    `scrypt$16$8$99$c2FsdA==$${Buffer.alloc(64).toString('base64')}`,
    'scrypt$16$8$1$c2FsdA==$kurz',
  ])('behandelt den beschädigten Hash %j als „falsch“, ohne zu werfen', async (stored) => {
    expect(await verifyPasscode(phrase, stored)).toBe(false);
  });

  it('funktioniert mit den Standardparametern (N = 2^17, r = 8, p = 1)', async () => {
    expect(DEFAULT_SCRYPT_PARAMS).toEqual({ N: 131072, r: 8, p: 1 });
    const hash = await hashPasscode(phrase);
    expect(hash.startsWith('scrypt$131072$8$1$')).toBe(true);
    expect(await verifyPasscode(phrase, hash)).toBe(true);
    expect(await verifyPasscode('falsch falsch', hash)).toBe(false);
  }, 30_000);
});

describe('checkPasscodeStrength', () => {
  it('verlangt mindestens acht und höchstens 128 Zeichen', () => {
    expect(checkPasscodeStrength('x'.repeat(PASSCODE_MIN_LENGTH - 1))).toBe('too_short');
    expect(checkPasscodeStrength('x'.repeat(PASSCODE_MIN_LENGTH))).toBeNull();
    expect(checkPasscodeStrength('x'.repeat(PASSCODE_MAX_LENGTH))).toBeNull();
    expect(checkPasscodeStrength('x'.repeat(PASSCODE_MAX_LENGTH + 1))).toBe('too_long');
  });

  it('zählt Zeichen, nicht Bytes', () => {
    expect(checkPasscodeStrength('ä'.repeat(8))).toBeNull();
    expect(checkPasscodeStrength('😀'.repeat(8))).toBeNull();
    expect(checkPasscodeStrength('😀'.repeat(7))).toBe('too_short');
  });

  it('stellt keine Anforderungen an Zeichenarten', () => {
    expect(checkPasscodeStrength('12345678')).toBeNull();
    expect(checkPasscodeStrength('nur kleine buchstaben')).toBeNull();
  });
});
