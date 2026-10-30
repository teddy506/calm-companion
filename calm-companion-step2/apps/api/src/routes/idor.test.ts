/**
 * IDOR/RBAC-matrix: hvert endpoint × hver aktør, inkl. "forkert ejer" med gyldig rolle.
 * CLAUDE.md: "Alle endpoints tjekker rolle OG ejerskab (IDOR-test pr. endpoint)".
 * Testen "dækker alle routes" fejler, hvis et nyt endpoint tilføjes uden en række her.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { InMemoryCareTeamRepository } from "../authz/careTeam.js";
import { ORIGIN, login, testApp, user } from "../test/helpers.js";

type Actor = "anon" | "p1" | "p2" | "c1" | "c2" | "a1";
type Case = {
  method: "GET" | "POST" | "DELETE";
  url: string;
  body?: Record<string, string>;
  expect: Record<Actor, number>;
};

// p1 er tilknyttet c1. p2 har ingen kliniker. c2 har ingen patienter. a1 er admin.
const USERS = [
  user("p1", "patient"),
  user("p2", "patient"),
  user("c1", "clinician"),
  user("c2", "clinician"),
  user("a1", "admin"),
];

/** Routes uden login (bevidst offentlige). Alt andet SKAL have en række i MATRIX. */
const PUBLIC_ROUTES = new Set(["GET /health", "GET /auth/login/:provider", "GET /auth/callback/:provider"]);

const MATRIX: Record<string, Case[]> = {
  "GET /me": [{ method: "GET", url: "/me", expect: { anon: 401, p1: 200, p2: 200, c1: 200, c2: 200, a1: 200 } }],
  "POST /auth/logout": [
    // Logout virker for alle, men rammer kun egen session (se separat test nedenfor).
    { method: "POST", url: "/auth/logout", expect: { anon: 204, p1: 204, p2: 204, c1: 204, c2: 204, a1: 204 } },
  ],
  "GET /patients/:patientId": [
    // Ejer, tilknyttet kliniker: OK. Anden patient, ikke-tilknyttet kliniker: 404 (ingen enumeration). Admin: 403.
    { method: "GET", url: "/patients/p1", expect: { anon: 401, p1: 200, p2: 404, c1: 200, c2: 404, a1: 403 } },
    { method: "GET", url: "/patients/p2", expect: { anon: 401, p1: 404, p2: 200, c1: 404, c2: 404, a1: 403 } },
    // Ikke-eksisterende og ikke-patient-id'er ser ud som "ikke din".
    { method: "GET", url: "/patients/nobody", expect: { anon: 401, p1: 404, p2: 404, c1: 404, c2: 404, a1: 403 } },
    { method: "GET", url: "/patients/c1", expect: { anon: 401, p1: 404, p2: 404, c1: 404, c2: 404, a1: 403 } },
  ],
  "GET /clinician/patients": [
    { method: "GET", url: "/clinician/patients", expect: { anon: 401, p1: 403, p2: 403, c1: 200, c2: 200, a1: 403 } },
  ],
  "POST /admin/care-team-links": [
    // Bl.a.: en kliniker kan ikke selv tilknytte sig en patient.
    {
      method: "POST",
      url: "/admin/care-team-links",
      body: { clinicianId: "c2", patientId: "p1" },
      expect: { anon: 401, p1: 403, p2: 403, c1: 403, c2: 403, a1: 201 },
    },
  ],
  "DELETE /admin/care-team-links": [
    {
      method: "DELETE",
      url: "/admin/care-team-links",
      body: { clinicianId: "c1", patientId: "p1" },
      expect: { anon: 401, p1: 403, p2: 403, c1: 403, c2: 403, a1: 204 },
    },
  ],
};

const ACTORS: Actor[] = ["anon", "p1", "p2", "c1", "c2", "a1"];

async function setup() {
  const careTeams = new InMemoryCareTeamRepository([["c1", "p1"]]);
  const { app } = await testApp(USERS, { careTeams });
  const sessions: Partial<Record<Actor, string>> = {};
  for (const u of USERS) sessions[u.id as Actor] = await login(app, u.provider, u.subject);
  return { app, careTeams, sessions };
}

function request(app: FastifyInstance, c: Case, session: string | undefined) {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (session) headers.cookie = session;
  return c.body === undefined
    ? app.inject({ method: c.method, url: c.url, headers })
    : app.inject({ method: c.method, url: c.url, headers, payload: c.body });
}

describe("IDOR/RBAC-matrix", () => {
  for (const [route, cases] of Object.entries(MATRIX)) {
    for (const c of cases) {
      for (const actor of ACTORS) {
        it(`${route} ${c.url} som ${actor} -> ${c.expect[actor]}`, async () => {
          // Frisk app pr. case, så tilstandsændringer (logout, links) ikke påvirker hinanden.
          const { app, sessions } = await setup();
          try {
            const res = await request(app, c, sessions[actor]);
            expect(res.statusCode).toBe(c.expect[actor]);
            if (res.statusCode >= 400) expect(res.body).not.toMatch(/"id"/); // ingen data i fejlsvar
          } finally {
            await app.close();
          }
        });
      }
    }
  }

  it("dækker alle routes (nyt endpoint uden IDOR-test = rød CI)", async () => {
    const { app } = await testApp([]);
    const uncovered = app.routeList.filter((r) => !PUBLIC_ROUTES.has(r) && !(r in MATRIX));
    await app.close();
    expect(uncovered).toEqual([]);
  });
});

describe("ejerskab: svarindhold og tilstand", () => {
  let app: FastifyInstance;
  let careTeams: InMemoryCareTeamRepository;
  let sessions: Partial<Record<Actor, string>>;
  beforeAll(async () => ({ app, careTeams, sessions } = await setup()));
  afterAll(async () => app.close());

  const get = (url: string, actor: Actor) =>
    app.inject({ method: "GET", url, headers: { cookie: sessions[actor] ?? "" } });

  it("/me returnerer altid den indloggede bruger, aldrig en anden", async () => {
    for (const actor of ["p1", "p2", "c1", "a1"] as const) {
      expect((await get("/me", actor)).json().id).toBe(actor);
    }
  });

  it("klinikerens patientliste indeholder kun egne patienter", async () => {
    expect((await get("/clinician/patients", "c1")).json()).toEqual({ patients: [{ id: "p1" }] });
    expect((await get("/clinician/patients", "c2")).json()).toEqual({ patients: [] });
  });

  it("query-parametre kan ikke bruges til at skifte bruger", async () => {
    expect((await get("/me?id=p2&userId=p2", "p1")).json().id).toBe("p1");
    expect((await get("/clinician/patients?clinicianId=c1", "c2")).json()).toEqual({ patients: [] });
  });

  it("adgang følger tilknytning: link giver adgang, unlink fjerner den straks", async () => {
    const admin = { origin: ORIGIN, cookie: sessions.a1 ?? "" };
    expect((await get("/patients/p2", "c2")).statusCode).toBe(404);
    const add = await app.inject({
      method: "POST", url: "/admin/care-team-links", headers: admin, payload: { clinicianId: "c2", patientId: "p2" },
    });
    expect(add.statusCode).toBe(201);
    expect((await get("/patients/p2", "c2")).statusCode).toBe(200);
    const del = await app.inject({
      method: "DELETE", url: "/admin/care-team-links", headers: admin, payload: { clinicianId: "c2", patientId: "p2" },
    });
    expect(del.statusCode).toBe(204);
    expect((await get("/patients/p2", "c2")).statusCode).toBe(404);
    expect(await careTeams.isLinked("c2", "p2")).toBe(false);
  });

  it("admin kan ikke oprette ugyldige relationer (fx patient som kliniker)", async () => {
    const admin = { origin: ORIGIN, cookie: sessions.a1 ?? "" };
    for (const payload of [
      { clinicianId: "p1", patientId: "p2" },
      { clinicianId: "c1", patientId: "c2" },
      { clinicianId: "a1", patientId: "p1" },
      { clinicianId: "ghost", patientId: "p1" },
    ]) {
      const res = await app.inject({ method: "POST", url: "/admin/care-team-links", headers: admin, payload });
      expect(res.statusCode).toBe(422);
    }
  });

  it("logout rammer kun egen session", async () => {
    const { app: a, sessions: s } = await setup();
    await a.inject({ method: "POST", url: "/auth/logout", headers: { origin: ORIGIN, cookie: s.p1 ?? "" } });
    expect((await a.inject({ method: "GET", url: "/me", headers: { cookie: s.p1 ?? "" } })).statusCode).toBe(401);
    expect((await a.inject({ method: "GET", url: "/me", headers: { cookie: s.p2 ?? "" } })).statusCode).toBe(200);
    await a.close();
  });
});

describe("inputvalidering (zod)", () => {
  let app: FastifyInstance;
  let sessions: Partial<Record<Actor, string>>;
  beforeAll(async () => ({ app, sessions } = await setup()));
  afterAll(async () => app.close());

  it("afviser ugyldige id'er", async () => {
    for (const id of ["p1%27%20OR%201=1", "a".repeat(65), "%2E%2E%2Fadmin"]) {
      const res = await app.inject({ method: "GET", url: `/patients/${id}`, headers: { cookie: sessions.p1 ?? "" } });
      expect(res.statusCode).toBe(400);
    }
  });

  it("afviser ukendte felter og forkerte typer i body", async () => {
    const headers = { origin: ORIGIN, cookie: sessions.a1 ?? "" };
    for (const payload of [
      { clinicianId: "c1", patientId: "p2", role: "admin" },
      { clinicianId: ["c1"], patientId: "p2" },
      { clinicianId: "c1" },
    ]) {
      const res = await app.inject({ method: "POST", url: "/admin/care-team-links", headers, payload });
      expect(res.statusCode).toBe(400);
    }
  });
});
