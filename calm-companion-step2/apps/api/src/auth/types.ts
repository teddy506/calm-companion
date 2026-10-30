/** Login-kanaler. Patienter logger ind via MitID-broker, personale via SSO. */
export type ProviderName = "patient" | "staff";
export const PROVIDERS: readonly ProviderName[] = ["patient", "staff"];

export type Role = "patient" | "clinician" | "admin";

/** Hvilke roller må logge ind via hvilken kanal. En patientkonto kan aldrig komme ind via SSO og omvendt. */
export const ALLOWED_ROLES: Record<ProviderName, readonly Role[]> = {
  patient: ["patient"],
  staff: ["clinician", "admin"],
};

export type User = {
  /** Intern, pseudonym id (aldrig CPR eller IdP-subject). */
  id: string;
  role: Role;
  provider: ProviderName;
  /** OIDC `sub` fra udbyderen. Unik pr. udbyder. */
  subject: string;
  active: boolean;
};
