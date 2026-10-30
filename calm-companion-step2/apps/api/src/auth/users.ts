import type { ProviderName, User } from "./types.js";
import { ALLOWED_ROLES } from "./types.js";

/**
 * Appens egen brugerliste: login beviser identitet, roller kommer herfra (ikke fra IdP).
 * In-memory indtil datamodellen i trin 3; interfacet bevares, når PostgreSQL kommer på.
 */
export interface UserDirectory {
  findByIdentity(provider: ProviderName, subject: string): Promise<User | undefined>;
  findById(id: string): Promise<User | undefined>;
}

export class InMemoryUserDirectory implements UserDirectory {
  private readonly byId = new Map<string, User>();

  constructor(users: User[] = []) {
    for (const u of users) this.add(u);
  }

  add(user: User): void {
    if (!ALLOWED_ROLES[user.provider].includes(user.role)) {
      throw new Error(`Rollen ${user.role} kan ikke logge ind via ${user.provider}`);
    }
    for (const existing of this.byId.values()) {
      if (existing.provider === user.provider && existing.subject === user.subject && existing.id !== user.id) {
        throw new Error("Identiteten er allerede knyttet til en anden bruger");
      }
    }
    this.byId.set(user.id, { ...user });
  }

  async findByIdentity(provider: ProviderName, subject: string): Promise<User | undefined> {
    for (const u of this.byId.values()) {
      if (u.provider === provider && u.subject === subject) return { ...u };
    }
    return undefined;
  }

  async findById(id: string): Promise<User | undefined> {
    const u = this.byId.get(id);
    return u ? { ...u } : undefined;
  }
}
