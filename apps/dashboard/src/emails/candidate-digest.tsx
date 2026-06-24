import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { PoolBreakdown } from "@/lib/notifications/types";
import type { Dictionary } from "@/lib/i18n";

export interface CandidateDigestEmailProps {
  orgName: string;
  total: number;
  byPool: PoolBreakdown[];
  dashboardUrl: string;
  logoUrl: string;
  dictionary: Dictionary;
}

function candidatesLabel(total: number, d: Dictionary): string {
  return total === 1
    ? d.email.digestLabelSingular
    : `${total} ${d.email.digestLabelPlural}`;
}

export function CandidateDigestEmail({
  orgName,
  total,
  byPool: _byPool,
  dashboardUrl,
  logoUrl,
  dictionary,
}: CandidateDigestEmailProps) {
  const d = dictionary;
  return (
    <Html lang="it">
      <Head />
      <Preview>{`${candidatesLabel(total, d)} ${d.email.digestSubject}`}</Preview>
      <Body
        style={{
          fontFamily: "Arial, sans-serif",
          backgroundColor: "#f6f6f6",
          padding: "24px",
        }}
      >
        <Container
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "8px",
            padding: "32px",
          }}
        >
          <Section style={{ textAlign: "center", margin: "0 0 24px" }}>
            <Img
              src={logoUrl}
              alt="Kubri"
              width={62}
              height={65}
              style={{ margin: "0 auto", display: "block" }}
            />
          </Section>
          <Heading as="h1" style={{ textAlign: "center", fontSize: "20px", margin: "0 0px 30px" }}>
            {d.email.digestHeading} <span style={{ color: "#7c4fe0" }}>{`${orgName}`}</span>
          </Heading>
          <Text style={{ textAlign: "center", margin: "0 0 0" }}> {d.email.digestIntro} {`${total === 1 ? d.email.digestEntered : d.email.digestEnteredPlural}`}
          </Text>
          <Text style={{ textAlign: "center", fontWeight: "bold", fontSize: "18px", margin: "5px 0" }}>
            {candidatesLabel(total, d)}
          </Text>
          <Text style={{ textAlign: "center", margin: "0 0 16px" }}>
            {` ${d.email.digestPlatform} `}
          </Text>
          <Text style={{ textAlign: "center", margin: "25px 0 0" }}>
            <Link
              href={dashboardUrl}
              style={{
                display: "inline-block",
                margin: "0 auto",
                backgroundColor: "#7c4fe0",
                color: "#ffffff",
                padding: "5px 16px",
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              {d.email.digestCta}
            </Link>

          </Text>

          <Section style={{ textAlign: "center", margin: "16px 0", fontSize: "10px", color: "#666666" }}>
            {d.email.digestUnsubscribe}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

import { it } from "@/lib/i18n/dictionaries/it";

CandidateDigestEmail.PreviewProps = {
  orgName: "Coop Esempio",
  total: 3,
  byPool: [
    { poolId: "p1", poolName: "Magazzino", count: 2 },
    { poolId: "p2", poolName: "Sala", count: 1 },
  ],
  dashboardUrl: "https://dashboard.kubri.it/dashboard/candidates",
  // Served by the react-email dev server from src/emails/static/. In production
  // sendDigest passes an absolute URL to the public asset instead.
  logoUrl: "/static/kubri-logo.png",
  dictionary: it,
} satisfies CandidateDigestEmailProps;

export default CandidateDigestEmail;
