import { prisma } from "@/lib/db";
import { getOrgAccessiblePoolIds } from "@/lib/pools/access";

export interface ListSummary {
  id: string;
  name: string;
  memberCount: number;
}

/** Helper puro: candidateId -> nomi delle liste a cui appartiene. */
export function buildListNamesByCandidate(
  lists: { id: string; name: string }[],
  memberships: { listId: string; candidateId: string }[],
): Record<string, string[]> {
  const nameById = new Map(lists.map((l) => [l.id, l.name]));
  const out: Record<string, string[]> = {};
  for (const m of memberships) {
    const name = nameById.get(m.listId);
    if (!name) continue;
    (out[m.candidateId] ??= []).push(name);
  }
  return out;
}

/** Liste dell'org con conteggio membri, ordinate per nome. */
export async function getListsForOrg(
  organizationId: string,
): Promise<ListSummary[]> {
  const rows = await prisma.candidateList.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, _count: { select: { members: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, memberCount: r._count.members }));
}

/** Liste dell'org (solo id+name) per popolare i menu. */
export async function getListOptionsForOrg(
  organizationId: string,
): Promise<{ id: string; name: string }[]> {
  return prisma.candidateList.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/** Mappa candidateId -> listIds[] per le liste dell'org (stato dei menu). */
export async function getListIdsByCandidateForOrg(
  organizationId: string,
): Promise<Record<string, string[]>> {
  const rows = await prisma.candidateListMembership.findMany({
    where: { list: { organizationId } },
    select: { listId: true, candidateId: true },
  });
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.candidateId] ??= []).push(r.listId);
  return out;
}

/** Mappa candidateId -> nomi liste (per l'export CSV). */
export async function getListNamesByCandidateForOrg(
  organizationId: string,
): Promise<Record<string, string[]>> {
  const [lists, memberships] = await Promise.all([
    getListOptionsForOrg(organizationId),
    prisma.candidateListMembership.findMany({
      where: { list: { organizationId } },
      select: { listId: true, candidateId: true },
    }),
  ]);
  return buildListNamesByCandidate(lists, memberships);
}

/** Una lista dell'org con i candidateId dei membri (accesso scoping a valle). */
export async function getListWithMemberIds(
  organizationId: string,
  listId: string,
): Promise<{ id: string; name: string; candidateIds: string[] } | null> {
  const list = await prisma.candidateList.findFirst({
    where: { id: listId, organizationId },
    select: { id: true, name: true, members: { select: { candidateId: true } } },
  });
  if (!list) return null;
  return {
    id: list.id,
    name: list.name,
    candidateIds: list.members.map((m) => m.candidateId),
  };
}

/** Restringe un set di candidati a quelli presenti nella lista. */
export async function getMemberCandidateIdSet(
  organizationId: string,
  listId: string,
): Promise<Set<string> | null> {
  const list = await getListWithMemberIds(organizationId, listId);
  if (!list) return null;
  return new Set(list.candidateIds);
}

export { getOrgAccessiblePoolIds };
