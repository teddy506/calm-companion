import { describe, expect, it } from "vitest";
import { InMemoryCareTeamRepository } from "./careTeam.js";
import { canAccessPatient } from "./policy.js";
import { user } from "../test/helpers.js";

describe("canAccessPatient", () => {
  const teams = new InMemoryCareTeamRepository([["c1", "p1"]]);

  it("patient: kun sig selv", async () => {
    expect(await canAccessPatient(user("p1", "patient"), "p1", teams)).toBe(true);
    expect(await canAccessPatient(user("p1", "patient"), "p2", teams)).toBe(false);
  });

  it("kliniker: kun tilknyttede patienter", async () => {
    expect(await canAccessPatient(user("c1", "clinician"), "p1", teams)).toBe(true);
    expect(await canAccessPatient(user("c1", "clinician"), "p2", teams)).toBe(false);
    expect(await canAccessPatient(user("c2", "clinician"), "p1", teams)).toBe(false);
  });

  it("admin: aldrig patientdata", async () => {
    expect(await canAccessPatient(user("a1", "admin"), "p1", teams)).toBe(false);
  });

  it("inaktiv bruger: ingen adgang, heller ikke til sig selv", async () => {
    expect(await canAccessPatient(user("p1", "patient", { active: false }), "p1", teams)).toBe(false);
    expect(await canAccessPatient(user("c1", "clinician", { active: false }), "p1", teams)).toBe(false);
  });

  it("ukendt rolle: ingen adgang (fail closed)", async () => {
    const weird = { ...user("x", "patient"), role: "superuser" } as unknown as Parameters<typeof canAccessPatient>[0];
    expect(await canAccessPatient(weird, "x", teams)).toBe(false);
  });
});
