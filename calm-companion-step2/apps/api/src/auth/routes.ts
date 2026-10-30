import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { currentUser, requireRole } from "./guards.js";
import type { OidcProvider } from "./oidc.js";
import type { PendingLoginStore, SessionStore } from "./sessions.js";
import { ALLOWED_ROLES, PROVIDERS, type ProviderName } from "./types.js";
import type { UserDirectory } from "./users.js";

export const SESSION_COOKIE = "__Host-cc_session";
export const LOGIN_COOKIE = "__Host-cc_login";

const cookieOpts = { path: "/", httpOnly: true, secure: true, sameSite: "lax" } as const;

export type AuthDeps = {
  publicBaseUrl: string;
  users: UserDirectory;
  sessions: SessionStore;
  pendingLogins: PendingLoginStore;
  oidc: Partial<Record<ProviderName, OidcProvider>>;
};

const providerParams = z.object({ provider: z.enum(PROVIDERS as [ProviderName, ...ProviderName[]]) });

const callbackQuery = z
  .object({
    state: z.string().min(1).max(512),
    code: z.string().min(1).max(2048).optional(),
    error: z.string().max(256).optional(),
  })
  .passthrough(); // fx iss, session_state – valideres af openid-client

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function registerAuth(app: FastifyInstance, deps: AuthDeps): Promise<void> {
  const base = new URL(deps.publicBaseUrl);
  const expectedOrigin = base.origin;

  // CSRF-forsvar ud over SameSite: tilstandsændrende requests skal komme fra vores egen origin.
  app.addHook("onRequest", async (request, reply) => {
    if (UNSAFE_METHODS.has(request.method) && request.headers.origin !== expectedOrigin) {
      return reply.code(403).send({ error: "bad_origin" });
    }
  });

  // Session -> bruger. Inaktive brugere logges ud med det samme.
  app.addHook("onRequest", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const userId = deps.sessions.touch(token);
    const user = userId ? await deps.users.findById(userId) : undefined;
    if (user?.active && ALLOWED_ROLES[user.provider].includes(user.role)) {
      request.user = user;
    } else {
      deps.sessions.destroy(token);
      reply.clearCookie(SESSION_COOKIE, cookieOpts);
    }
  });

  const redirectUri = (provider: ProviderName) => new URL(`/auth/callback/${provider}`, base).toString();

  app.get("/auth/login/:provider", async (request, reply) => {
    const params = providerParams.safeParse(request.params);
    const provider = params.success ? deps.oidc[params.data.provider] : undefined;
    if (!params.success || !provider) return reply.code(404).send({ error: "unknown_provider" });

    let auth;
    try {
      auth = await provider.createAuthRequest(redirectUri(params.data.provider));
    } catch (err) {
      request.log.error({ err }, "OIDC discovery/authorization request fejlede");
      return reply.code(503).send({ error: "idp_unavailable" });
    }
    const loginToken = deps.pendingLogins.create({
      provider: params.data.provider,
      state: auth.state,
      nonce: auth.nonce,
      codeVerifier: auth.codeVerifier,
    });
    reply.setCookie(LOGIN_COOKIE, loginToken, { ...cookieOpts, maxAge: 600 });
    return reply.redirect(auth.url.toString(), 302);
  });

  app.get("/auth/callback/:provider", async (request, reply) => {
    const loginToken = request.cookies[LOGIN_COOKIE];
    reply.clearCookie(LOGIN_COOKIE, cookieOpts);
    const pending = loginToken ? deps.pendingLogins.take(loginToken) : undefined;

    const params = providerParams.safeParse(request.params);
    const query = callbackQuery.safeParse(request.query);
    const provider = params.success ? deps.oidc[params.data.provider] : undefined;
    if (!params.success || !provider) return reply.code(404).send({ error: "unknown_provider" });
    if (!query.success || !pending || pending.provider !== params.data.provider || pending.state !== query.data.state) {
      return reply.code(400).send({ error: "invalid_login_state" });
    }
    if (query.data.error || !query.data.code) return reply.code(401).send({ error: "login_failed" });

    let subject: string;
    try {
      ({ subject } = await provider.completeLogin(new URL(request.url, base), pending));
    } catch (err) {
      // Ingen detaljer til klienten; ingen tokens/claims i log.
      request.log.warn({ errName: (err as Error).name }, "OIDC callback afvist");
      return reply.code(401).send({ error: "login_failed" });
    }

    const user = await deps.users.findByIdentity(params.data.provider, subject);
    if (!user || !user.active || !ALLOWED_ROLES[params.data.provider].includes(user.role)) {
      // Selvregistrering/onboarding kommer i trin 5. Indtil da: kun kendte brugere (fail closed).
      return reply.code(403).send({ error: "not_provisioned" });
    }

    // Altid ny session ved login (forhindrer session fixation).
    const old = request.cookies[SESSION_COOKIE];
    if (old) deps.sessions.destroy(old);
    reply.setCookie(SESSION_COOKIE, deps.sessions.create(user.id), cookieOpts);
    return reply.redirect("/", 302);
  });

  app.post("/auth/logout", async (request, reply: FastifyReply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) deps.sessions.destroy(token);
    reply.clearCookie(SESSION_COOKIE, cookieOpts);
    return reply.code(204).send();
  });

  app.get("/me", { preHandler: requireRole("patient", "clinician", "admin") }, async (request) => {
    const user = currentUser(request);
    return { id: user.id, role: user.role };
  });
}
