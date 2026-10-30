import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { LOGIN_COOKIE, SESSION_COOKIE } from "./routes.js";
import { ORIGIN, cookieValue, login, testApp, user } from "../test/helpers.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const patient = user("p1", "patient");
const clinician = user("c1", "clinician");

async function startLogin(a: FastifyInstance, provider = "patient") {
  const res = await a.inject({ method: "GET", url: `/auth/login/${provider}` });
  const state = new URL(String(res.headers.location)).searchParams.get("state") ?? "";
  const loginCookie = cookieValue(res.headers["set-cookie"], LOGIN_COOKIE) ?? "";
  return { res, state, loginCookie };
}

describe("login-flow (OIDC, BFF)", () => {
  it("redirecter til udbyderen og sætter en sikker, kortlivet login-cookie", async () => {
    ({ app } = await testApp([patient]));
    const { res } = await startLogin(app);
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toMatch(/^https:\/\/idp\.example\.test\/authorize/);
    expect(new URL(String(res.headers.location)).searchParams.get("redirect_uri")).toBe(
      "https://cc.example.test/auth/callback/patient",
    );
    const raw = String(res.headers["set-cookie"]);
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/Secure/);
    expect(raw).toMatch(/SameSite=Lax/);
    expect(raw).toMatch(/Max-Age=600/);
  });

  it("ukendt eller ukonfigureret udbyder giver 404", async () => {
    ({ app } = await testApp([], { oidc: {} }));
    expect((await app.inject({ method: "GET", url: "/auth/login/patient" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/auth/login/evil" })).statusCode).toBe(404);
  });

  it("gennemfører login og giver en HttpOnly-session; tokens sendes aldrig til browseren", async () => {
    ({ app } = await testApp([patient]));
    const { state, loginCookie } = await startLogin(app);
    const cb = await app.inject({
      method: "GET",
      url: `/auth/callback/patient?state=${state}&code=sub:sub-p1`,
      headers: { cookie: `${LOGIN_COOKIE}=${loginCookie}` },
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe("/");
    const cookies = String(cb.headers["set-cookie"]);
    expect(cookies).toMatch(new RegExp(`${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; Secure; SameSite=Lax`));
    expect(cb.body).not.toMatch(/token/i);

    const session = `${SESSION_COOKIE}=${cookieValue(cb.headers["set-cookie"], SESSION_COOKIE)}`;
    const me = await app.inject({ method: "GET", url: "/me", headers: { cookie: session } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ id: "p1", role: "patient" });
  });

  it("afviser callback uden login-cookie (login-CSRF)", async () => {
    ({ app } = await testApp([patient]));
    const { state } = await startLogin(app);
    const cb = await app.inject({ method: "GET", url: `/auth/callback/patient?state=${state}&code=sub:sub-p1` });
    expect(cb.statusCode).toBe(400);
  });

  it("afviser forkert state", async () => {
    ({ app } = await testApp([patient]));
    const { loginCookie } = await startLogin(app);
    const cb = await app.inject({
      method: "GET",
      url: "/auth/callback/patient?state=forged&code=sub:sub-p1",
      headers: { cookie: `${LOGIN_COOKIE}=${loginCookie}` },
    });
    expect(cb.statusCode).toBe(400);
  });

  it("login-forsøg er engangsbrug (replay afvises)", async () => {
    ({ app } = await testApp([patient]));
    const { state, loginCookie } = await startLogin(app);
    const req = {
      method: "GET" as const,
      url: `/auth/callback/patient?state=${state}&code=sub:sub-p1`,
      headers: { cookie: `${LOGIN_COOKIE}=${loginCookie}` },
    };
    expect((await app.inject(req)).statusCode).toBe(302);
    expect((await app.inject(req)).statusCode).toBe(400);
  });

  it("login startet hos én udbyder kan ikke afsluttes hos en anden", async () => {
    ({ app } = await testApp([patient, clinician]));
    const { state, loginCookie } = await startLogin(app, "patient");
    const cb = await app.inject({
      method: "GET",
      url: `/auth/callback/staff?state=${state}&code=sub:sub-c1`,
      headers: { cookie: `${LOGIN_COOKIE}=${loginCookie}` },
    });
    expect(cb.statusCode).toBe(400);
  });

  it("sender nonce og PKCE-verifier videre til validering", async () => {
    let oidc;
    ({ app, oidc } = await testApp([patient]));
    await login(app, "patient", "sub-p1");
    expect(oidc.patient.lastChecks).toMatchObject({ nonce: "nonce-1", codeVerifier: "verifier-1", state: "state-1" });
  });

  it("ugyldigt token-svar fra udbyderen giver 401 uden detaljer", async () => {
    ({ app } = await testApp([patient]));
    const { state, loginCookie } = await startLogin(app);
    const cb = await app.inject({
      method: "GET",
      url: `/auth/callback/patient?state=${state}&code=bad`,
      headers: { cookie: `${LOGIN_COOKIE}=${loginCookie}` },
    });
    expect(cb.statusCode).toBe(401);
    expect(cb.json()).toEqual({ error: "login_failed" });
  });

  it("fejl fra udbyderen (error=access_denied) giver 401", async () => {
    ({ app } = await testApp([patient]));
    const { state, loginCookie } = await startLogin(app);
    const cb = await app.inject({
      method: "GET",
      url: `/auth/callback/patient?state=${state}&error=access_denied`,
      headers: { cookie: `${LOGIN_COOKIE}=${loginCookie}` },
    });
    expect(cb.statusCode).toBe(401);
  });

  it("ukendt identitet får ingen session (fail closed indtil onboarding i trin 5)", async () => {
    ({ app } = await testApp([]));
    const { state, loginCookie } = await startLogin(app);
    const cb = await app.inject({
      method: "GET",
      url: `/auth/callback/patient?state=${state}&code=sub:stranger`,
      headers: { cookie: `${LOGIN_COOKIE}=${loginCookie}` },
    });
    expect(cb.statusCode).toBe(403);
    expect(cookieValue(cb.headers["set-cookie"], SESSION_COOKIE)).toBeUndefined();
  });

  it("deaktiveret bruger kan ikke logge ind", async () => {
    ({ app } = await testApp([user("p2", "patient", { active: false })]));
    const { state, loginCookie } = await startLogin(app);
    const cb = await app.inject({
      method: "GET",
      url: `/auth/callback/patient?state=${state}&code=sub:sub-p2`,
      headers: { cookie: `${LOGIN_COOKIE}=${loginCookie}` },
    });
    expect(cb.statusCode).toBe(403);
  });

  it("klinikerens SSO-subject giver ikke adgang via patient-login", async () => {
    ({ app } = await testApp([clinician]));
    const { state, loginCookie } = await startLogin(app, "patient");
    const cb = await app.inject({
      method: "GET",
      url: `/auth/callback/patient?state=${state}&code=sub:sub-c1`,
      headers: { cookie: `${LOGIN_COOKIE}=${loginCookie}` },
    });
    expect(cb.statusCode).toBe(403);
  });

  it("nyt login erstatter eksisterende session (session fixation)", async () => {
    ({ app } = await testApp([patient]));
    const first = await login(app, "patient", "sub-p1");
    const { state, loginCookie } = await startLogin(app);
    const cb = await app.inject({
      method: "GET",
      url: `/auth/callback/patient?state=${state}&code=sub:sub-p1`,
      headers: { cookie: `${LOGIN_COOKIE}=${loginCookie}; ${first}` },
    });
    expect(cb.statusCode).toBe(302);
    expect(`${SESSION_COOKIE}=${cookieValue(cb.headers["set-cookie"], SESSION_COOKIE)}`).not.toBe(first);
    expect((await app.inject({ method: "GET", url: "/me", headers: { cookie: first } })).statusCode).toBe(401);
  });
});

describe("session og logout", () => {
  it("/me kræver login", async () => {
    ({ app } = await testApp([]));
    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
    const forged = await app.inject({ method: "GET", url: "/me", headers: { cookie: `${SESSION_COOKIE}=forged` } });
    expect(forged.statusCode).toBe(401);
  });

  it("logout ugyldiggør sessionen server-side", async () => {
    ({ app } = await testApp([patient]));
    const session = await login(app, "patient", "sub-p1");
    const out = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: session, origin: ORIGIN } });
    expect(out.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/me", headers: { cookie: session } })).statusCode).toBe(401);
  });

  it("deaktivering af en bruger slår igennem på eksisterende session", async () => {
    let directory;
    ({ app, directory } = await testApp([patient]));
    const session = await login(app, "patient", "sub-p1");
    directory.add({ ...patient, active: false });
    expect((await app.inject({ method: "GET", url: "/me", headers: { cookie: session } })).statusCode).toBe(401);
  });

  it("tilstandsændrende requests uden korrekt Origin afvises (CSRF)", async () => {
    ({ app } = await testApp([patient]));
    const session = await login(app, "patient", "sub-p1");
    for (const origin of [undefined, "https://evil.example.test", "null"]) {
      const headers: Record<string, string> = { cookie: session };
      if (origin) headers.origin = origin;
      const res = await app.inject({ method: "POST", url: "/auth/logout", headers });
      expect(res.statusCode).toBe(403);
    }
    expect((await app.inject({ method: "GET", url: "/me", headers: { cookie: session } })).statusCode).toBe(200);
  });
});
