// Kun til tests. Syntetiske data; ingen rigtige identiteter.
import type { FastifyInstance } from "fastify";
import { expect } from "vitest";
import { buildApp, type AppOptions } from "../app.js";
import type { AuthRequest, LoginChecks, OidcProvider } from "../auth/oidc.js";
import { LOGIN_COOKIE, SESSION_COOKIE } from "../auth/routes.js";
import type { ProviderName, User } from "../auth/types.js";
import { InMemoryUserDirectory } from "../auth/users.js";

export const BASE = "https://cc.example.test";
export const ORIGIN = BASE;

/**
 * Fake OIDC-udbyder. `code` har formen `sub:<subject>`; "bad" simulerer en ugyldig token-respons
 * (fx forkert signatur/nonce), som den rigtige adapter ville afvise.
 */
export class FakeOidcProvider implements OidcProvider {
  private n = 0;
  lastChecks: LoginChecks | undefined;

  async createAuthRequest(redirectUri: string): Promise<AuthRequest> {
    this.n += 1;
    const state = `state-${this.n}`;
    const url = new URL("https://idp.example.test/authorize");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", redirectUri);
    return { url, state, nonce: `nonce-${this.n}`, codeVerifier: `verifier-${this.n}` };
  }

  async completeLogin(callbackUrl: URL, checks: LoginChecks): Promise<{ subject: string }> {
    this.lastChecks = checks;
    if (callbackUrl.searchParams.get("state") !== checks.state) throw new Error("state mismatch");
    const code = callbackUrl.searchParams.get("code") ?? "";
    if (!code.startsWith("sub:")) throw new Error("invalid grant");
    return { subject: code.slice(4) };
  }
}

export function user(id: string, role: User["role"], overrides: Partial<User> = {}): User {
  return {
    id,
    role,
    provider: role === "patient" ? "patient" : "staff",
    subject: `sub-${id}`,
    active: true,
    ...overrides,
  };
}

export async function testApp(users: User[], opts: AppOptions = {}) {
  const directory = new InMemoryUserDirectory(users);
  const oidc = { patient: new FakeOidcProvider(), staff: new FakeOidcProvider() };
  const app = await buildApp({ logger: false, publicBaseUrl: BASE, users: directory, oidc, ...opts });
  return { app, directory, oidc };
}

export function cookieValue(setCookie: string | string[] | undefined, name: string): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const c of list) {
    const [pair] = c.split(";");
    const idx = pair?.indexOf("=") ?? -1;
    if (pair && idx > 0 && pair.slice(0, idx) === name) return pair.slice(idx + 1);
  }
  return undefined;
}

/** Kører hele login-flowet og returnerer session-cookien (`navn=værdi`). */
export async function login(app: FastifyInstance, provider: ProviderName, subject: string): Promise<string> {
  const start = await app.inject({ method: "GET", url: `/auth/login/${provider}` });
  expect(start.statusCode).toBe(302);
  const state = new URL(String(start.headers.location)).searchParams.get("state") ?? "";
  const loginCookie = cookieValue(start.headers["set-cookie"], LOGIN_COOKIE);
  const cb = await app.inject({
    method: "GET",
    url: `/auth/callback/${provider}?state=${encodeURIComponent(state)}&code=${encodeURIComponent(`sub:${subject}`)}`,
    headers: { cookie: `${LOGIN_COOKIE}=${loginCookie}` },
  });
  expect(cb.statusCode).toBe(302);
  const session = cookieValue(cb.headers["set-cookie"], SESSION_COOKIE);
  if (!session) throw new Error("ingen session-cookie");
  return `${SESSION_COOKIE}=${session}`;
}
