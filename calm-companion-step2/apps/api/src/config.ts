import { z } from "zod";

const optionalNonEmpty = z.string().min(1).optional();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  // Kun til lokal udvikling. I test/prod bruges KMS/secrets manager.
  DEV_FIELD_KEY: z.string().regex(/^[0-9a-f]{64}$/).optional(),

  // Offentlig URL for API/BFF. Bruges til OIDC redirect-URI og Origin-tjek (CSRF).
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),

  // OIDC: patienter (MitID-broker) og klinikere/admins (SSO). Udbyder er endnu ikke valgt,
  // så alt er generisk OIDC og konfigureres via miljø. Client secrets hentes fra secrets manager.
  OIDC_PATIENT_ISSUER: z.string().url().optional(),
  OIDC_PATIENT_CLIENT_ID: optionalNonEmpty,
  OIDC_PATIENT_CLIENT_SECRET: optionalNonEmpty,
  OIDC_STAFF_ISSUER: z.string().url().optional(),
  OIDC_STAFF_CLIENT_ID: optionalNonEmpty,
  OIDC_STAFF_CLIENT_SECRET: optionalNonEmpty,
});

export type Config = z.infer<typeof schema>;

export type OidcSettings = { issuer: string; clientId: string; clientSecret: string };

function oidcSettings(
  issuer: string | undefined,
  clientId: string | undefined,
  clientSecret: string | undefined,
): OidcSettings | undefined {
  const set = [issuer, clientId, clientSecret].filter((v) => v !== undefined).length;
  if (set === 0) return undefined;
  if (set !== 3 || !issuer || !clientId || !clientSecret) {
    throw new Error("OIDC-konfiguration er ufuldstændig (issuer, client id og secret kræves samlet)");
  }
  return { issuer, clientId, clientSecret };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = schema.parse(env); // kaster ved manglende/ugyldig konfiguration (fail fast)
  if (cfg.NODE_ENV === "production" && cfg.DEV_FIELD_KEY) {
    throw new Error("DEV_FIELD_KEY må ikke bruges i production");
  }
  const patient = patientOidc(cfg);
  const staff = staffOidc(cfg);
  if (cfg.NODE_ENV === "production") {
    if (!patient || !staff) throw new Error("OIDC skal være konfigureret for både patienter og personale i production");
    if (!cfg.PUBLIC_BASE_URL.startsWith("https://")) throw new Error("PUBLIC_BASE_URL skal være https i production");
  }
  return cfg;
}

export function patientOidc(cfg: Config): OidcSettings | undefined {
  return oidcSettings(cfg.OIDC_PATIENT_ISSUER, cfg.OIDC_PATIENT_CLIENT_ID, cfg.OIDC_PATIENT_CLIENT_SECRET);
}

export function staffOidc(cfg: Config): OidcSettings | undefined {
  return oidcSettings(cfg.OIDC_STAFF_ISSUER, cfg.OIDC_STAFF_CLIENT_ID, cfg.OIDC_STAFF_CLIENT_SECRET);
}
