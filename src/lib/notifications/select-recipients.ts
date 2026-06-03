import { WEEKLY_SEND_DAY } from "./config";
import { prisma } from "@/lib/db";

export function isWeeklyDue(now: Date): boolean {
  return now.getUTCDay() === WEEKLY_SEND_DAY;
}

export interface Recipient {
  id: string;
  email: string;
  organizationId: string;
  organizationName: string;
  lastNotifiedAt: Date | null;
  createdAt: Date;
}

export async function getDueRecipients(now: Date): Promise<Recipient[]> {
  const weeklyDue = isWeeklyDue(now);
  const frequencies: ("DAILY" | "WEEKLY")[] = weeklyDue
    ? ["DAILY", "WEEKLY"]
    : ["DAILY"];

  const users = await prisma.user.findMany({
    where: {
      notifyEnabled: true,
      organizationId: { not: null },
      notifyFrequency: { in: frequencies },
    },
    select: {
      id: true,
      email: true,
      organizationId: true,
      lastNotifiedAt: true,
      createdAt: true,
      organization: { select: { name: true } },
    },
  });

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    organizationId: u.organizationId as string,
    organizationName: u.organization?.name ?? "",
    lastNotifiedAt: u.lastNotifiedAt,
    createdAt: u.createdAt,
  }));
}
