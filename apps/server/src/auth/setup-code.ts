import { randomInt, timingSafeEqual } from 'node:crypto';

// Ohne 0, O, 1, I und L, damit sich nichts verwechseln lässt.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUP_LENGTH = 5;
const GROUPS = 2;

/** Erzeugt einen Einrichtungscode wie `K7M2P-X9QRA` (zehn Zeichen aus einem eindeutigen Alphabet). */
export function generateSetupCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = '';
    for (let i = 0; i < GROUP_LENGTH; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join('-');
}

/** Groß, ohne Leerzeichen und Bindestriche: Eingaben vom iPhone dürfen etwas schlampig sein. */
export function normalizeSetupCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function setupCodeMatches(expected: string, input: string): boolean {
  const a = Buffer.from(normalizeSetupCode(expected));
  const b = Buffer.from(normalizeSetupCode(input));
  return a.length === b.length && timingSafeEqual(a, b);
}
