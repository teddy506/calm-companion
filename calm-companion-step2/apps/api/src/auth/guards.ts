import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Role, User } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Sat af session-hooket, hvis requesten har en gyldig session for en aktiv bruger. */
    user?: User;
  }
}

/** Kræver login. Bruges via `requireRole` på alle beskyttede endpoints. */
export function currentUser(request: FastifyRequest): User {
  if (!request.user) throw new Error("currentUser kaldt uden requireRole-guard");
  return request.user;
}

/**
 * Rolle-guard (RBAC). Fail closed: uden session 401, forkert rolle 403.
 * Ejerskab (IDOR) tjekkes derudover i hvert endpoint via `authz/policy`.
 */
export function requireRole(...roles: Role[]): preHandlerHookHandler {
  if (roles.length === 0) throw new Error("requireRole kræver mindst én rolle");
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthenticated" });
    if (!roles.includes(request.user.role)) return reply.code(403).send({ error: "forbidden" });
  };
}
