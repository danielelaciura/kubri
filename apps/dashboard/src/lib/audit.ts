import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

interface AuditLogParams {
  userId: string;
  organizationId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
}

export async function logAudit(params: AuditLogParams) {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      organizationId: params.organizationId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      metadata: (params.metadata as Prisma.InputJsonValue) ?? undefined,
    },
  });
}
