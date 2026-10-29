import type { Database } from "./db";

export interface OrganizationRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

const SELECT = { id: true, slug: true, name: true } as const;

export async function createOrganization(
  db: Database,
  input: { slug: string; name: string },
): Promise<OrganizationRecord> {
  return db.organization.create({ data: input, select: SELECT });
}

export async function findOrganizationBySlug(
  db: Database,
  slug: string,
): Promise<OrganizationRecord | null> {
  return db.organization.findUnique({ where: { slug }, select: SELECT });
}
