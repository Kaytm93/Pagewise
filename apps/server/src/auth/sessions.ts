import { createHash, randomBytes } from 'node:crypto';
import { eq, lte, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions } from '../db/schema';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionServiceOptions {
  now?: () => Date;
  /** Eine Sitzung läuft nach so langer Untätigkeit ab. */
  idleMs?: number;
  /** Selbst bei Dauerbetrieb endet jede Sitzung nach dieser Zeit. */
  absoluteMs?: number;
  /** So selten wird „zuletzt gesehen“ in die Datenbank geschrieben. */
  touchIntervalMs?: number;
}

export interface NewSession {
  token: string;
  csrfToken: string;
  maxAgeSeconds: number;
}

export interface ActiveSession {
  csrfToken: string;
  /** `true`, wenn die Laufzeit gerade verlängert wurde, dann sollte der Cookie erneuert werden. */
  renewed: boolean;
  maxAgeSeconds: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class SessionService {
  private readonly now: () => Date;
  private readonly idleMs: number;
  private readonly absoluteMs: number;
  private readonly touchIntervalMs: number;

  constructor(
    private readonly db: Db,
    options: SessionServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.idleMs = options.idleMs ?? 30 * DAY_MS;
    this.absoluteMs = options.absoluteMs ?? 90 * DAY_MS;
    this.touchIntervalMs = options.touchIntervalMs ?? 60 * 1000;
  }

  /** Legt eine Sitzung an. Das Token verlässt den Server nur im Cookie, gespeichert wird sein Hash. */
  create(): NewSession {
    const now = this.now();
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Math.min(now.getTime() + this.idleMs, now.getTime() + this.absoluteMs),
    );
    this.db
      .insert(sessions)
      .values({
        tokenHash: hashToken(token),
        csrfToken,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
      })
      .run();
    return {
      token,
      csrfToken,
      maxAgeSeconds: Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
    };
  }

  validate(token: string | undefined): ActiveSession | null {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
    const tokenHash = hashToken(token);
    const row = this.db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).get();
    if (!row) return null;

    const now = this.now();
    if (row.expiresAt.getTime() <= now.getTime()) {
      this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
      return null;
    }

    let expiresAt = row.expiresAt;
    let renewed = false;
    if (now.getTime() - row.lastSeenAt.getTime() >= this.touchIntervalMs) {
      expiresAt = new Date(
        Math.min(row.createdAt.getTime() + this.absoluteMs, now.getTime() + this.idleMs),
      );
      this.db
        .update(sessions)
        .set({ lastSeenAt: now, expiresAt })
        .where(eq(sessions.tokenHash, tokenHash))
        .run();
      renewed = true;
    }
    return {
      csrfToken: row.csrfToken,
      renewed,
      maxAgeSeconds: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
    };
  }

  revoke(token: string | undefined): void {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return;
    this.db
      .delete(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)))
      .run();
  }

  /** Beendet alle Sitzungen, auf Wunsch außer der angegebenen (z. B. nach einem Passcode-Wechsel). */
  revokeAll(exceptToken?: string): void {
    if (exceptToken && TOKEN_PATTERN.test(exceptToken)) {
      this.db
        .delete(sessions)
        .where(ne(sessions.tokenHash, hashToken(exceptToken)))
        .run();
    } else {
      this.db.delete(sessions).run();
    }
  }

  /** Räumt abgelaufene Sitzungen auf und gibt zurück, wie viele es waren. */
  purgeExpired(): number {
    return this.db.delete(sessions).where(lte(sessions.expiresAt, this.now())).run().changes;
  }
}
