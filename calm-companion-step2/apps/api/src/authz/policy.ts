import type { User } from "../auth/types.js";
import type { CareTeamRepository } from "./careTeam.js";

/**
 * Ejerskabsregel for patientdata (IDOR-beskyttelse). Fail closed: alt, der ikke eksplicit er tilladt, er forbudt.
 * - patient: kun egne data
 * - kliniker: kun patienter, klinikeren er tilknyttet via care team
 * - admin: ingen adgang til patientdata (GDPR art. 9). Nødadgang ("break glass") er en separat, auditeret feature.
 */
export async function canAccessPatient(user: User, patientId: string, careTeams: CareTeamRepository): Promise<boolean> {
  if (!user.active) return false;
  switch (user.role) {
    case "patient":
      return user.id === patientId;
    case "clinician":
      return careTeams.isLinked(user.id, patientId);
    case "admin":
      return false;
    default:
      return false;
  }
}
