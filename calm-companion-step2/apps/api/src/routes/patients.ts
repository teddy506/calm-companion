import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser, requireRole } from "../auth/guards.js";
import type { UserDirectory } from "../auth/users.js";
import type { CareTeamRepository } from "../authz/careTeam.js";
import { canAccessPatient } from "../authz/policy.js";

export type PatientRouteDeps = {
  users: UserDirectory;
  careTeams: CareTeamRepository;
};

/** Interne id'er: pseudonyme, URL-sikre. Bliver UUID'er i trin 3. */
export const userId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const patientParams = z.object({ patientId: userId }).strict();
const linkBody = z.object({ clinicianId: userId, patientId: userId }).strict();

export async function registerPatientRoutes(app: FastifyInstance, deps: PatientRouteDeps): Promise<void> {
  /**
   * Patientens profil (kun pseudonym id indtil datamodellen i trin 3).
   * Ikke-eksisterende og ikke-tilladte patienter giver samme 404, så id'er ikke kan enumereres.
   */
  app.get("/patients/:patientId", { preHandler: requireRole("patient", "clinician") }, async (request, reply) => {
    const params = patientParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const user = currentUser(request);
    const target = await deps.users.findById(params.data.patientId);
    if (!target || target.role !== "patient" || !(await canAccessPatient(user, target.id, deps.careTeams))) {
      return reply.code(404).send({ error: "not_found" });
    }
    return { id: target.id };
  });

  /** Klinikerens egne patienter. Ejerskab er implicit: kun den indloggede klinikers liste. */
  app.get("/clinician/patients", { preHandler: requireRole("clinician") }, async (request) => {
    const user = currentUser(request);
    return { patients: (await deps.careTeams.patientsOf(user.id)).map((id) => ({ id })) };
  });

  /** Admin: tilknyt/fjern kliniker <-> patient. Admin ser ikke patientdata, kun relationen. */
  app.post("/admin/care-team-links", { preHandler: requireRole("admin") }, async (request, reply) => {
    const body = linkBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const [clinician, patient] = await Promise.all([
      deps.users.findById(body.data.clinicianId),
      deps.users.findById(body.data.patientId),
    ]);
    if (clinician?.role !== "clinician" || !clinician.active || patient?.role !== "patient") {
      return reply.code(422).send({ error: "invalid_link" });
    }
    await deps.careTeams.link(clinician.id, patient.id);
    return reply.code(201).send({ clinicianId: clinician.id, patientId: patient.id });
  });

  app.delete("/admin/care-team-links", { preHandler: requireRole("admin") }, async (request, reply) => {
    const body = linkBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const removed = await deps.careTeams.unlink(body.data.clinicianId, body.data.patientId);
    return reply.code(removed ? 204 : 404).send(removed ? undefined : { error: "not_found" });
  });
}
