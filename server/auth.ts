import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { deleteSession, extendSession, findSession, findUserById, insertSession, type UserRow } from './db';

/**
 * Passwords: scrypt (N=2^15, r=8, p=1), per-user 16-byte salt, 64-byte key,
 * stored as `scrypt$<N>$<salt b64>$<key b64>` so parameters can change later.
 * Sessions: 32 random bytes in the cookie; only the SHA-256 is stored.
 */

const SCRYPT_N = 32768;
export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** Sessions used with less than this left get extended to a full TTL again. */
const SESSION_RENEW_BELOW_MS = 90 * 24 * 60 * 60 * 1000;

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,39}$/i;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: SCRYPT_N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, nStr, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !nStr || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(nStr),
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(db: DatabaseSync, userId: number, now = Date.now()): string {
  const token = randomBytes(32).toString('base64url');
  insertSession(db, hashToken(token), userId, new Date(now + SESSION_TTL_MS).toISOString());
  return token;
}

/** The user for a cookie token, or undefined. Extends sessions nearing expiry. */
export function resolveSession(db: DatabaseSync, token: string | undefined, now = Date.now()): UserRow | undefined {
  if (!token || token.length > 200) return undefined;
  const tokenHash = hashToken(token);
  const session = findSession(db, tokenHash);
  if (!session) return undefined;
  const expiresAt = Date.parse(session.expiresAt);
  if (!(expiresAt > now)) {
    deleteSession(db, tokenHash);
    return undefined;
  }
  if (expiresAt - now < SESSION_RENEW_BELOW_MS) {
    extendSession(db, tokenHash, new Date(now + SESSION_TTL_MS).toISOString());
  }
  return findUserById(db, session.userId);
}

export function destroySession(db: DatabaseSync, token: string | undefined): void {
  if (token) deleteSession(db, hashToken(token));
}

/**
 * Login throttle, in memory, per client address. After `maxFailures` failed
 * attempts within `windowMs` the address is locked for `lockoutMs`. A success
 * clears the count. Nothing here needs to survive a restart.
 */
export class LoginLimiter {
  private readonly entries = new Map<string, { failures: number; firstAt: number; lockedUntil: number }>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly lockoutMs: number;

  constructor(maxFailures = 10, windowMs = 15 * 60 * 1000, lockoutMs = 15 * 60 * 1000) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.lockoutMs = lockoutMs;
  }

  /** Milliseconds until this key may try again; 0 when allowed. */
  retryAfterMs(key: string, now = Date.now()): number {
    const e = this.entries.get(key);
    if (!e) return 0;
    if (e.lockedUntil > now) return e.lockedUntil - now;
    if (now - e.firstAt > this.windowMs) this.entries.delete(key);
    return 0;
  }

  recordFailure(key: string, now = Date.now()): void {
    const e = this.entries.get(key);
    if (!e || now - e.firstAt > this.windowMs) {
      this.entries.set(key, { failures: 1, firstAt: now, lockedUntil: 0 });
      return;
    }
    e.failures += 1;
    if (e.failures >= this.maxFailures) e.lockedUntil = now + this.lockoutMs;
    if (this.entries.size > 10_000) this.prune(now);
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    for (const [k, e] of this.entries) {
      if (e.lockedUntil <= now && now - e.firstAt > this.windowMs) this.entries.delete(k);
    }
  }
}
