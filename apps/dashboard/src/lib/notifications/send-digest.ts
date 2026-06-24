import { render } from "@react-email/components";
import { prisma } from "@/lib/db";
import { resend, EMAIL_FROM } from "@/lib/email/client";
import { CandidateDigestEmail } from "@/emails/candidate-digest";
import type { PoolBreakdown } from "./types";
import { getDictionary, isLocale, DEFAULT_LOCALE } from "@/lib/i18n";

const APP_URL = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";

export async function sendDigest(
  user: { id: string; email: string; language?: string | null },
  orgName: string,
  breakdown: PoolBreakdown[],
): Promise<void> {
  const total = breakdown.reduce((sum, b) => sum + b.count, 0);
  const dashboardUrl = `${APP_URL}/dashboard/candidates`;
  const logoUrl = `${APP_URL}/kubri-logo.png`;

  const dictionary = getDictionary(
    isLocale(user.language) ? user.language : DEFAULT_LOCALE,
  );

  const html = await render(
    CandidateDigestEmail({
      orgName,
      total,
      byPool: breakdown,
      dashboardUrl,
      logoUrl,
      dictionary,
    }),
  );

  const subject = total === 1
    ? `${dictionary.email.digestLabelSingular} ${dictionary.email.digestSubject}`
    : `${total} ${dictionary.email.digestLabelPlural} ${dictionary.email.digestSubject}`;

  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: user.email,
    subject,
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
