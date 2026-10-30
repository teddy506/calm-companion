import { describe, expect, it } from "vitest";
import { PendingLoginStore, SessionStore, hashToken } from "./sessions.js";
import { InMemoryUserDirectory } from "./users.js";

describe("SessionStore", () => {
  const opts = { idleMs: 1000, absoluteMs: 5000 };

  it("opretter og slår sessioner op", () => {
    const store = new SessionStore(opts, () => 0);
    const token = store.create("u1");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.touch(token)).toBe("u1");
    expect(store.touch("ukendt")).toBeUndefined();
  });

  it("udløber efter inaktivitet", () => {
    let t = 0;
    const store = new SessionStore(opts, () => t);
    const token = store.create("u1");
    t = 1001;
    expect(store.touch(token)).toBeUndefined();
  });

  it("aktivitet forlænger, men ikke ud over absolut levetid", () => {
    let t = 0;
    const store = new SessionStore(opts, () => t);
    const token = store.create("u1");
    for (t = 900; t <= 4500; t += 900) expect(store.touch(token)).toBe("u1");
    t = 5001;
    expect(store.touch(token)).toBeUndefined();
  });

  it("destroy og destroyAllForUser ugyldiggør sessioner", () => {
    const store = new SessionStore(opts, () => 0);
    const a = store.create("u1");
    const b = store.create("u1");
    const c = store.create("u2");
    store.destroy(a);
    expect(store.touch(a)).toBeUndefined();
    store.destroyAllForUser("u1");
    expect(store.touch(b)).toBeUndefined();
    expect(store.touch(c)).toBe("u2");
  });

  it("hasher tokens deterministisk og uden at afsløre input", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toContain("abc");
  });
});

describe("PendingLoginStore", () => {
  const login = { provider: "patient", state: "s", nonce: "n", codeVerifier: "v" };

  it("er engangsbrug", () => {
    const store = new PendingLoginStore(1000, () => 0);
    const token = store.create(login);
    expect(store.take(token)?.state).toBe("s");
    expect(store.take(token)).toBeUndefined();
  });

  it("udløber", () => {
    let t = 0;
    const store = new PendingLoginStore(1000, () => t);
    const token = store.create(login);
    t = 1001;
    expect(store.take(token)).toBeUndefined();
  });
});

describe("InMemoryUserDirectory", () => {
  it("afviser patientrolle via personale-login og omvendt", () => {
    const dir = new InMemoryUserDirectory();
    expect(() => dir.add({ id: "x", role: "patient", provider: "staff", subject: "s", active: true })).toThrow();
    expect(() => dir.add({ id: "y", role: "clinician", provider: "patient", subject: "s", active: true })).toThrow();
  });

  it("afviser samme identitet på to brugere", () => {
    const dir = new InMemoryUserDirectory([{ id: "a", role: "patient", provider: "patient", subject: "s", active: true }]);
    expect(() => dir.add({ id: "b", role: "patient", provider: "patient", subject: "s", active: true })).toThrow();
  });

  it("slår op på (udbyder, subject) – samme subject hos anden udbyder er en anden person", async () => {
    const dir = new InMemoryUserDirectory([{ id: "a", role: "patient", provider: "patient", subject: "s", active: true }]);
    expect((await dir.findByIdentity("patient", "s"))?.id).toBe("a");
    expect(await dir.findByIdentity("staff", "s")).toBeUndefined();
  });
});
