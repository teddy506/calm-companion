import { createHash, randomBytes } from "node:crypto";

/** Opake tokens: 256 bit tilfældighed, base64url. Kun hash gemmes server-side. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type Clock = () => number;

export type SessionOptions = {
  /** Inaktivitet før sessionen udløber. */
  idleMs: number;
  /** Maksimal levetid uanset aktivitet. */
  absoluteMs: number;
};

export const DEFAULT_SESSION_OPTIONS: SessionOptions = {
  idleMs: 30 * 60 * 1000,
  absoluteMs: 12 * 60 * 60 * 1000,
};

type SessionRecord = { userId: string; createdAt: number; lastSeenAt: number };

/**
 * Server-side sessioner (BFF). Browseren får kun et opakt id i en HttpOnly-cookie.
 * Nøglen i lageret er SHA-256 af id'et, så et læk af lageret ikke giver brugbare cookies.
 * In-memory indtil trin 3 (flyttes til PostgreSQL/Redis; interfacet bevares).
 */
export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly opts: SessionOptions = DEFAULT_SESSION_OPTIONS,
    private readonly now: Clock = Date.now,
  ) {}

  create(userId: string): string {
    const token = newToken();
    const t = this.now();
    this.sessions.set(hashToken(token), { userId, createdAt: t, lastSeenAt: t });
    return token;
  }

  /** Returnerer userId for en gyldig session og forlænger inaktivitetsvinduet. */
  touch(token: string): string | undefined {
    const key = hashToken(token);
    const s = this.sessions.get(key);
    if (!s) return undefined;
    const t = this.now();
    if (t - s.lastSeenAt > this.opts.idleMs || t - s.createdAt > this.opts.absoluteMs) {
      this.sessions.delete(key);
      return undefined;
    }
    s.lastSeenAt = t;
    return s.userId;
  }

  destroy(token: string): void {
    this.sessions.delete(hashToken(token));
  }

  /** Bruges når en bruger deaktiveres eller skifter rolle. */
  destroyAllForUser(userId: string): void {
    for (const [k, s] of this.sessions) if (s.userId === userId) this.sessions.delete(k);
  }
}

export type PendingLogin = {
  provider: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
};

/** Kortlivede, engangs-loginforsøg (state/nonce/PKCE), bundet til browseren via cookie. */
export class PendingLoginStore {
  private readonly pending = new Map<string, PendingLogin>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly now: Clock = Date.now,
  ) {}

  create(login: Omit<PendingLogin, "createdAt">): string {
    const token = newToken();
    this.pending.set(hashToken(token), { ...login, createdAt: this.now() });
    return token;
  }

  /** Engangsbrug: posten slettes altid ved opslag. */
  take(token: string): PendingLogin | undefined {
    const key = hashToken(token);
    const p = this.pending.get(key);
    this.pending.delete(key);
    if (!p || this.now() - p.createdAt > this.ttlMs) return undefined;
    return p;
  }
}
