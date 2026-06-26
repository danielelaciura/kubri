import React from "react";
import {
  Document, Page, Text, View, StyleSheet, Font, Svg, Circle, Line,
} from "@react-pdf/renderer";
import path from "node:path";
import { DOMAIN_LABELS, type AssessmentReport } from "@kubri/contracts";
import { computeReportLayout, CANVAS_W, CANVAS_H } from "@/lib/report/layout";

Font.register({
  family: "Onest",
  fonts: [
    { src: path.join(process.cwd(), "src/components/report/fonts/Onest-var.ttf"), fontWeight: 400 },
    { src: path.join(process.cwd(), "src/components/report/fonts/Onest-var.ttf"), fontWeight: 600 },
    { src: path.join(process.cwd(), "src/components/report/fonts/Onest-var.ttf"), fontWeight: 800 },
  ],
});

const PURPLE = "#534AB7";
const PURPLE_DK = "#3C3489";
const PURPLE_LT = "#EEEDFE";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 11, fontFamily: "Onest", color: "#1a1a1a" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: PURPLE, paddingBottom: 12, marginBottom: 16 },
  brand: { fontSize: 10, letterSpacing: 2, color: PURPLE, fontWeight: 800 },
  title: { fontSize: 20, fontWeight: 800, marginTop: 4 },
  name: { fontSize: 12, fontWeight: 800, color: "#333", textAlign: "right" },
  date: { fontSize: 9, color: "#888", textAlign: "right" },
  sectionLabel: { fontSize: 9, letterSpacing: 1.5, color: PURPLE, fontWeight: 800, marginBottom: 6, marginTop: 14 },
  intro: { fontSize: 11.5, color: "#333", lineHeight: 1.5 },
  domainHeader: { backgroundColor: PURPLE_LT, color: PURPLE_DK, fontWeight: 800, padding: 5, marginTop: 8 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f0f0f0", paddingVertical: 5 },
  cName: { width: "34%", paddingHorizontal: 6 },
  cLevel: { width: "16%", paddingHorizontal: 6 },
  cNote: { width: "50%", paddingHorizontal: 6, color: "#555" },
  badge: { backgroundColor: PURPLE, color: "#fff", fontSize: 9, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  footer: { marginTop: 18, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#eee", fontSize: 9, color: "#999" },
});

function Map({ report }: { report: AssessmentReport }) {
  const layout = computeReportLayout(report.domains);
  return (
    <Svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} style={{ width: "100%", height: 250 }}>
      {layout.edges.map((e, i) => (
        <Line key={`e${i}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} strokeWidth={2.5} stroke="#C9C4F0" />
      ))}
      {layout.domains.flatMap((d) =>
        d.leaves.map((leaf, j) => (
          <Line key={`l${d.id}${j}`} x1={d.x} y1={d.y} x2={leaf.x} y2={leaf.y} strokeWidth={1.5} stroke="#E4E2FC" />
        )),
      )}
      {layout.domains.flatMap((d) =>
        d.leaves.map((leaf, j) => <Circle key={`lc${d.id}${j}`} cx={leaf.x} cy={leaf.y} r={3} fill="#AFA9EC" />),
      )}
      {layout.domains.map((d) => (
        <React.Fragment key={d.id}>
          <Circle cx={d.x} cy={d.y} r={34} fill={PURPLE_LT} stroke={PURPLE} strokeWidth={2} />
          <Text x={d.x} y={d.y + 3} style={{ fontSize: 9, fontWeight: 700, color: PURPLE_DK, textAlign: "center" }}>
            {d.label}
          </Text>
        </React.Fragment>
      ))}
      <Circle cx={layout.center.x} cy={layout.center.y} r={40} fill={PURPLE} />
      <Text x={layout.center.x} y={layout.center.y + 3} style={{ fontSize: 10, fontWeight: 800, color: "#fff", textAlign: "center" }}>
        competenze
      </Text>
    </Svg>
  );
}

function ReportDoc({ report, name }: { report: AssessmentReport; name?: string }) {
  const date = new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>KUBRI</Text>
            <Text style={styles.title}>Il tuo profilo di competenze</Text>
          </View>
          <View>
            {name ? <Text style={styles.name}>{name}</Text> : null}
            <Text style={styles.date}>{date}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>IN SINTESI</Text>
        <Text style={styles.intro}>{report.intro}</Text>

        <Text style={styles.sectionLabel}>LA TUA MAPPA</Text>
        <Map report={report} />

        <Text style={styles.sectionLabel}>DETTAGLIO COMPETENZE</Text>
        {report.domains.map((d) => (
          <View key={d.id} wrap={false}>
            <Text style={styles.domainHeader}>{DOMAIN_LABELS[d.id]}</Text>
            {d.competences.map((c, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.cName}>{c.name}</Text>
                <View style={styles.cLevel}><Text style={styles.badge}>{c.level}</Text></View>
                <Text style={styles.cNote}>{c.note}</Text>
              </View>
            ))}
          </View>
        ))}

        <Text style={styles.footer}>
          Report generato dalle tue risposte all&#39;assessment Kubri · Le competenze riflettono il profilo emerso, non una valutazione formale.
        </Text>
      </Page>
    </Document>
  );
}

export function renderCompetenceReportPdf(props: { report: AssessmentReport; name?: string }): React.ReactElement<React.ComponentProps<typeof Document>> {
  return <ReportDoc {...props} />;
}
