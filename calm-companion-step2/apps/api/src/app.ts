import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { OidcProvider } from "./auth/oidc.js";
import { registerAuth } from "./auth/routes.js";
import { PendingLoginStore, SessionStore } from "./auth/sessions.js";
import type { ProviderName } from "./auth/types.js";
import { InMemoryUserDirectory, type UserDirectory } from "./auth/users.js";
import { InMemoryCareTeamRepository, type CareTeamRepository } from "./authz/careTeam.js";
import { registerPatientRoutes } from "./routes/patients.js";

export type AppOptions = {
  logger?: boolean;
  publicBaseUrl?: string;
  users?: UserDirectory;
  sessions?: SessionStore;
  pendingLogins?: PendingLoginStore;
  oidc?: Partial<Record<ProviderName, OidcProvider>>;
  careTeams?: CareTeamRepository;
};

declare module "fastify" {
  interface FastifyInstance {
    /** "METHOD /url" for alle registrerede routes. Bruges af IDOR-testen til at kræve dækning pr. endpoint. */
    routeList: string[];
  }
}

export async function buildApp(opts: AppOptions = {}) {
  const app = Fastify({
    logger: opts.logger === false ? false : { redact: ["req.headers.authorization", "req.headers.cookie"] },
    bodyLimit: 64 * 1024,
  });
  const routeList: string[] = [];
  app.decorate("routeList", routeList);
  app.addHook("onRoute", (route) => {
    for (const m of [route.method].flat()) if (m !== "HEAD") routeList.push(`${m} ${route.url}`);
  });

  await app.register(helmet);
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(cookie);

  app.get("/health", async () => ({ status: "ok" }));

  const users = opts.users ?? new InMemoryUserDirectory();
  const sessions = opts.sessions ?? new SessionStore();
  await registerAuth(app, {
    publicBaseUrl: opts.publicBaseUrl ?? "http://localhost:3000",
    users,
    sessions,
    pendingLogins: opts.pendingLogins ?? new PendingLoginStore(),
    oidc: opts.oidc ?? {},
  });
  await registerPatientRoutes(app, { users, careTeams: opts.careTeams ?? new InMemoryCareTeamRepository() });

  return app;
}
