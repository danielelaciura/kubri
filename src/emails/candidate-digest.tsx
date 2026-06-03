import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { candidatesLabel } from "@/lib/notifications/config";
import type { PoolBreakdown } from "@/lib/notifications/types";

export interface CandidateDigestEmailProps {
  orgName: string;
  total: number;
  byPool: PoolBreakdown[];
  dashboardUrl: string;
}

export function CandidateDigestEmail({
  orgName,
  total,
  byPool,
  dashboardUrl,
}: CandidateDigestEmailProps) {
  return (
    <Html lang="it">
      <Head />
      <Preview>{`${candidatesLabel(total)} su Kubri`}</Preview>
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
          <Heading as="h1" style={{ fontSize: "20px", margin: "0 0 12px" }}>
            Nuovi candidati su Kubri
          </Heading>
          <Text style={{ margin: "0 0 16px" }}>
            {`${orgName}: ${total === 1 ? "è entrato" : "sono entrati"} ${candidatesLabel(
              total,
            )} in piattaforma.`}
          </Text>
          <Section>
            {byPool.map((p) => (
              <Text key={p.poolId} style={{ margin: "4px 0" }}>
                • {p.poolName}: {p.count}
              </Text>
            ))}
          </Section>
          <Link
            href={dashboardUrl}
            style={{
              display: "inline-block",
              marginTop: "20px",
              backgroundColor: "#111111",
              color: "#ffffff",
              padding: "10px 16px",
              borderRadius: "6px",
              textDecoration: "none",
            }}
          >
            Vedi i candidati
          </Link>
        </Container>
      </Body>
    </Html>
  );
}

CandidateDigestEmail.PreviewProps = {
  orgName: "Coop Esempio",
  total: 3,
  byPool: [
    { poolId: "p1", poolName: "Magazzino", count: 2 },
    { poolId: "p2", poolName: "Sala", count: 1 },
  ],
  dashboardUrl: "https://dashboard.kubri.it/dashboard/candidates",
} satisfies CandidateDigestEmailProps;

export default CandidateDigestEmail;
