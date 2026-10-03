import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { authCredentials } from '../db/schema';
import type { AttemptLimiter } from './attempt-limiter';
import {
  checkPasscodeStrength,
  DEFAULT_SCRYPT_PARAMS,
  hashPasscode,
  type ScryptParams,
  verifyPasscode,
} from './passcode';
import type { NewSession, SessionService } from './sessions';
import { generateSetupCode, setupCodeMatches } from './setup-code';

export type RateLimited = { ok: false; reason: 'rate_limited'; retryAfterSeconds: number };
export type WeakPasscode = { ok: false; reason: 'passcode_too_short' | 'passcode_too_long' };

export type SetupResult =
  | { ok: true; session: NewSession }
  | { ok: false; reason: 'already_configured' | 'invalid_setup_code' }
  | WeakPasscode
  | RateLimited;

export type LoginResult =
  | { ok: true; session: NewSession }
  | { ok: false; reason: 'not_configured' | 'invalid_passcode' }
  | RateLimited;

export type ChangePasscodeResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_passcode' }
  | WeakPasscode
  | RateLimited;

export interface AuthServiceDeps {
  db: Db;
  sessions: SessionService;
  limiter: AttemptLimiter;
  scryptParams?: ScryptParams;
}

/**
 * Einrichtung, Anmeldung und Passcode-Wechsel. Jeder Versuch zählt im Voraus als Fehlversuch und
 * wird bei Erfolg wieder gutgeschrieben. So lassen sich gleichzeitige Anfragen nicht nutzen, um
 * die Begrenzung zu umgehen, während das (langsame) Hashing noch läuft.
 */
export class AuthService {
  private setupCode: string | null;
  private readonly scryptParams: ScryptParams;

  constructor(private readonly deps: AuthServiceDeps) {
    this.scryptParams = deps.scryptParams ?? DEFAULT_SCRYPT_PARAMS;
    this.setupCode = this.isConfigured() ? null : generateSetupCode();
  }

  isConfigured(): boolean {
    return (
      this.deps.db
        .select({ id: authCredentials.id })
        .from(authCredentials)
        .where(eq(authCredentials.id, 1))
        .get() !== undefined
    );
  }

  /**
   * Der Einrichtungscode für die Konsole beim Start, solange noch kein Passcode gesetzt ist.
   * Wer die Einrichtung abschließen will, muss ihn kennen, also Zugriff auf den Rechner haben.
   */
  pendingSetupCode(): string | null {
    return this.isConfigured() ? null : this.setupCode;
  }

  async setup(input: { setupCode: string; passcode: string }): Promise<SetupResult> {
    if (this.isConfigured()) return { ok: false, reason: 'already_configured' };

    const decision = this.deps.limiter.check();
    if (!decision.allowed) {
      return { ok: false, reason: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
    }
    this.deps.limiter.recordFailure();

    if (!this.setupCode || !setupCodeMatches(this.setupCode, input.setupCode)) {
      return { ok: false, reason: 'invalid_setup_code' };
    }
    const problem = checkPasscodeStrength(input.passcode);
    if (problem) {
      this.deps.limiter.reset();
      return {
        ok: false,
        reason: problem === 'too_short' ? 'passcode_too_short' : 'passcode_too_long',
      };
    }

    const hash = await hashPasscode(input.passcode, this.scryptParams);
    const inserted = this.deps.db
      .insert(authCredentials)
      .values({ id: 1, passcodeHash: hash })
      .onConflictDoNothing()
      .run();
    if (inserted.changes === 0) return { ok: false, reason: 'already_configured' };

    this.setupCode = null;
    this.deps.limiter.reset();
    return { ok: true, session: this.deps.sessions.create() };
  }

  async login(passcode: string): Promise<LoginResult> {
    const row = this.deps.db.select().from(authCredentials).where(eq(authCredentials.id, 1)).get();
    if (!row) return { ok: false, reason: 'not_configured' };

    const decision = this.deps.limiter.check();
    if (!decision.allowed) {
      return { ok: false, reason: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
    }
    this.deps.limiter.recordFailure();

    if (!(await verifyPasscode(passcode, row.passcodeHash))) {
      return { ok: false, reason: 'invalid_passcode' };
    }
    this.deps.limiter.reset();
    this.deps.sessions.purgeExpired();
    return { ok: true, session: this.deps.sessions.create() };
  }

  /** Ändert den Passcode und beendet alle anderen Sitzungen. */
  async changePasscode(
    input: { current: string; next: string },
    currentToken: string | undefined,
  ): Promise<ChangePasscodeResult> {
    const row = this.deps.db.select().from(authCredentials).where(eq(authCredentials.id, 1)).get();
    if (!row) return { ok: false, reason: 'invalid_passcode' };

    const decision = this.deps.limiter.check();
    if (!decision.allowed) {
      return { ok: false, reason: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
    }
    const problem = checkPasscodeStrength(input.next);
    if (problem) {
      return {
        ok: false,
        reason: problem === 'too_short' ? 'passcode_too_short' : 'passcode_too_long',
      };
    }
    this.deps.limiter.recordFailure();

    if (!(await verifyPasscode(input.current, row.passcodeHash))) {
      return { ok: false, reason: 'invalid_passcode' };
    }
    const hash = await hashPasscode(input.next, this.scryptParams);
    this.deps.db
      .update(authCredentials)
      .set({ passcodeHash: hash })
      .where(eq(authCredentials.id, 1))
      .run();
    this.deps.limiter.reset();
    this.deps.sessions.revokeAll(currentToken);
    return { ok: true };
  }
}
