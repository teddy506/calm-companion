/**
 * Behandlerrelationer: hvilken kliniker må se hvilken patient.
 * In-memory indtil trin 3 (flyttes til PostgreSQL; interfacet bevares).
 */
export interface CareTeamRepository {
  isLinked(clinicianId: string, patientId: string): Promise<boolean>;
  patientsOf(clinicianId: string): Promise<string[]>;
  link(clinicianId: string, patientId: string): Promise<void>;
  unlink(clinicianId: string, patientId: string): Promise<boolean>;
}

export class InMemoryCareTeamRepository implements CareTeamRepository {
  private readonly links = new Map<string, Set<string>>();

  constructor(initial: Array<[clinicianId: string, patientId: string]> = []) {
    for (const [c, p] of initial) this.addSync(c, p);
  }

  private addSync(clinicianId: string, patientId: string): void {
    let set = this.links.get(clinicianId);
    if (!set) this.links.set(clinicianId, (set = new Set()));
    set.add(patientId);
  }

  async isLinked(clinicianId: string, patientId: string): Promise<boolean> {
    return this.links.get(clinicianId)?.has(patientId) ?? false;
  }

  async patientsOf(clinicianId: string): Promise<string[]> {
    return [...(this.links.get(clinicianId) ?? [])].sort();
  }

  async link(clinicianId: string, patientId: string): Promise<void> {
    this.addSync(clinicianId, patientId);
  }

  async unlink(clinicianId: string, patientId: string): Promise<boolean> {
    return this.links.get(clinicianId)?.delete(patientId) ?? false;
  }
}
