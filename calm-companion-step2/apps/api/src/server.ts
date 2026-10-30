import { buildApp } from "./app.js";
import { OpenIdClientProvider, type OidcProvider } from "./auth/oidc.js";
import type { ProviderName } from "./auth/types.js";
import { loadConfig, patientOidc, staffOidc } from "./config.js";

const cfg = loadConfig();
const oidc: Partial<Record<ProviderName, OidcProvider>> = {};
const patient = patientOidc(cfg);
const staff = staffOidc(cfg);
if (patient) oidc.patient = new OpenIdClientProvider(patient);
if (staff) oidc.staff = new OpenIdClientProvider(staff);

const app = await buildApp({ publicBaseUrl: cfg.PUBLIC_BASE_URL, oidc });
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
