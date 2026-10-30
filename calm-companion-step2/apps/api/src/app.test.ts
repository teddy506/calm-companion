import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

describe("app", () => {
  it("svarer på /health med sikkerhedsheaders", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    await app.close();
  });
});

describe("config", () => {
  it("fejler uden DATABASE_URL", () => {
    expect(() => loadConfig({ NODE_ENV: "test" })).toThrow();
  });
  it("afviser dev-nøgle i production", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", DATABASE_URL: "x", DEV_FIELD_KEY: "0".repeat(64) }),
    ).toThrow();
  });

  const oidcEnv = {
    OIDC_PATIENT_ISSUER: "https://patient-idp.example.test",
    OIDC_PATIENT_CLIENT_ID: "cc",
    OIDC_PATIENT_CLIENT_SECRET: "test-only",
    OIDC_STAFF_ISSUER: "https://staff-idp.example.test",
    OIDC_STAFF_CLIENT_ID: "cc",
    OIDC_STAFF_CLIENT_SECRET: "test-only",
  };

  it("kræver OIDC for både patienter og personale i production", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", DATABASE_URL: "x", PUBLIC_BASE_URL: "https://cc.example.test" }),
    ).toThrow(/OIDC/);
    expect(() =>
      loadConfig({ NODE_ENV: "production", DATABASE_URL: "x", PUBLIC_BASE_URL: "https://cc.example.test", ...oidcEnv }),
    ).not.toThrow();
  });

  it("kræver https i production", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", DATABASE_URL: "x", PUBLIC_BASE_URL: "http://cc.example.test", ...oidcEnv }),
    ).toThrow(/https/);
  });

  it("afviser halv OIDC-konfiguration", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "development", DATABASE_URL: "x", OIDC_PATIENT_ISSUER: "https://idp.example.test" }),
    ).toThrow(/ufuldstændig/);
  });
});
