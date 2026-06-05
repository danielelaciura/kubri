import { render } from "@react-email/components";
import { prisma } from "@/lib/db";
import { resend, EMAIL_FROM } from "@/lib/email/client";
import { CandidateDigestEmail } from "@/emails/candidate-digest";
import { candidatesLabel } from "./config";
import type { PoolBreakdown } from "./types";

const APP_URL = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";

export async function sendDigest(
  user: { id: string; email: string },
  orgName: string,
  breakdown: PoolBreakdown[],
): Promise<void> {
  const total = breakdown.reduce((sum, b) => sum + b.count, 0);
  const dashboardUrl = `${APP_URL}/dashboard/candidates`;
  const logoUrl = `${APP_URL}/kubri-logo.png`;

  const html = await render(
    CandidateDigestEmail({
      orgName,
      total,
      byPool: breakdown,
      dashboardUrl,
      logoUrl,
    }),
  );

  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: user.email,
    subject: `${candidatesLabel(total)} su Kubri`,
    html,
  });

  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastNotifiedAt: new Date() },
  });
}
