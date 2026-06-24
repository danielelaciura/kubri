import { prisma } from "@/lib/db";

export async function listPoolsWithCounts() {
  return prisma.pool.findMany({
    orderBy: [{ isGlobal: "desc" }, { name: "asc" }],
    include: {
      _count: { select: { candidates: true, organizations: true } },
    },
  });
}

export async function listOrgPoolsWithCandidateCount(organizationId: string) {
  return prisma.pool.findMany({
    where: {
      isGlobal: false,
      organizations: { some: { organizationId } },
    },
    orderBy: { name: "asc" },
    include: { _count: { select: { candidates: true } } },
  });
}

export async function getPoolDetail(id: string) {
  return prisma.pool.findUnique({
    where: { id },
    include: {
      _count: { select: { candidates: true } },
      organizations: {
        include: { organization: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}
