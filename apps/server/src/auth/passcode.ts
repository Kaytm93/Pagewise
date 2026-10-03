import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const PASSCODE_MIN_LENGTH = 8;
export const PASSCODE_MAX_LENGTH = 128;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/**
 * Empfehlung von OWASP für scrypt, wenn Argon2id nicht verfügbar ist: N = 2^17, r = 8, p = 1
 * (siehe docs/decisions.md, D-020). Tests dürfen schwächere Werte übergeben.
 */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** Obergrenzen für Werte aus einem gespeicherten Hash, damit eine manipulierte Zeile nichts aufbläht. */
const MAX_N = 2 ** 20;
const MAX_R = 16;
const MAX_P = 4;

/** Vereinheitlicht Unicode (iOS-Tastaturen liefern mal zusammengesetzte, mal getrennte Zeichen). */
function normalize(passcode: string): string {
  return passcode.normalize('NFKC');
}

export type PasscodeProblem = 'too_short' | 'too_long';

/** Prüft die Länge. Es gibt bewusst keine Zeichenregeln: lange Sätze sind besser als Sonderzeichen. */
export function checkPasscodeStrength(passcode: string): PasscodeProblem | null {
  const length = [...normalize(passcode)].length;
  if (length < PASSCODE_MIN_LENGTH) return 'too_short';
  if (length > PASSCODE_MAX_LENGTH) return 'too_long';
  return null;
}

function derive(passcode: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      normalize(passcode),
      salt,
      KEY_LENGTH,
      {
        N: params.N,
        r: params.r,
        p: params.p,
        maxmem: 128 * params.N * params.r + 4 * 1024 * 1024,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/** Format: `scrypt$N$r$p$salt$hash` (Base64). Das Präfix erlaubt später einen Wechsel auf Argon2id. */
export async function hashPasscode(
  passcode: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(passcode, salt, params);
  return [
    'scrypt',
    params.N,
    params.r,
    params.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

function parseStored(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, n, r, p, salt, key] = parts as [string, string, string, string, string, string];
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  const valid =
    Number.isInteger(params.N) &&
    Number.isInteger(params.r) &&
    Number.isInteger(params.p) &&
    params.N >= 2 &&
    (params.N & (params.N - 1)) === 0 &&
    params.N <= MAX_N &&
    params.r >= 1 &&
    params.r <= MAX_R &&
    params.p >= 1 &&
    params.p <= MAX_P;
  if (!valid) return null;
  const saltBytes = Buffer.from(salt, 'base64');
  const keyBytes = Buffer.from(key, 'base64');
  if (saltBytes.length === 0 || keyBytes.length !== KEY_LENGTH) return null;
  return { params, salt: saltBytes, key: keyBytes };
}

/** Prüft einen Passcode gegen den gespeicherten Hash. Ein kaputter Hash gilt als „falsch“. */
export async function verifyPasscode(passcode: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  if (!parsed) return false;
  const candidate = await derive(passcode, parsed.salt, parsed.params);
  return timingSafeEqual(candidate, parsed.key);
}
