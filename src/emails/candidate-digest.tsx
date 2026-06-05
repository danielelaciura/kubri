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
import { candidatesLabel } from "@/lib/notifications/config";
import type { PoolBreakdown } from "@/lib/notifications/types";

export interface CandidateDigestEmailProps {
  orgName: string;
  total: number;
  byPool: PoolBreakdown[];
  dashboardUrl: string;
  logoUrl: string;
}

export function CandidateDigestEmail({
  orgName,
  total,
  byPool,
  dashboardUrl,
  logoUrl,
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
            Nuovi candidati su Kubri per <span style={{ color: "#7c4fe0" }}>{`${orgName}`}</span>
          </Heading>
          <Text style={{ textAlign: "center", margin: "0 0 0" }}> Ciao, ti informiamo che nelle ultime ore {`${total === 1 ? "è entrato" : "sono entrati"}`}
          </Text>
          <Text style={{ textAlign: "center", fontWeight: "bold", fontSize: "18px", margin: "5px 0" }}>
            {candidatesLabel(
              total,
            )}
          </Text>
          <Text style={{ textAlign: "center", margin: "0 0 16px" }}>
            {" all'interno della nostra piattaforma. "}
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
              Vedi i candidati
            </Link>

          </Text>

          <Section style={{ textAlign: "center", margin: "16px 0", fontSize: "10px", color: "#666666" }}>
            Se non desideri più ricevere queste notifiche, puoi disabilitarle dalle tue impostazioni.
          </Section>
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
  // Served by the react-email dev server from src/emails/static/. In production
  // sendDigest passes an absolute URL to the public asset instead.
  logoUrl: "/static/kubri-logo.png",
} satisfies CandidateDigestEmailProps;

export default CandidateDigestEmail;
