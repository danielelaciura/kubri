import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { Candidate } from "@/types";

const BLUE = "#1e40af";
const GRAY = "#6b7280";
const LIGHT_GRAY = "#f3f4f6";

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
    borderBottomWidth: 2,
    borderBottomColor: BLUE,
    paddingBottom: 12,
  },
  brand: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: BLUE,
  },
  dateText: {
    fontSize: 9,
    color: GRAY,
  },
  candidateName: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    marginBottom: 20,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: BLUE,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: LIGHT_GRAY,
    paddingBottom: 4,
  },
  row: {
    flexDirection: "row",
    marginBottom: 4,
  },
  label: {
    width: 140,
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: GRAY,
  },
  value: {
    flex: 1,
    fontSize: 10,
  },
  listItem: {
    marginBottom: 3,
    paddingLeft: 8,
  },
  noteBlock: {
    marginBottom: 6,
    padding: 6,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 4,
  },
  noteAuthor: {
    fontSize: 8,
    color: GRAY,
    marginBottom: 2,
  },
  noteContent: {
    fontSize: 9,
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 8,
    color: GRAY,
  },
});

interface NoteData {
  content: string;
  userName: string;
  createdAt: Date;
}

interface CandidatePdfProps {
  candidate: Candidate;
  notes: NoteData[];
}

export function renderCandidatePdf({ candidate, notes }: CandidatePdfProps) {
  const c = candidate;
  const exportDate = new Date().toLocaleDateString("it-IT");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>Kubri</Text>
          <Text style={styles.dateText}>Esportato il {exportDate}</Text>
        </View>

        <Text style={styles.candidateName}>
          {c.firstName} {c.lastName}
        </Text>

        {/* Informazioni personali */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Informazioni personali</Text>
          {c.dateOfBirth && (
            <View style={styles.row}>
              <Text style={styles.label}>Data di nascita</Text>
              <Text style={styles.value}>{c.dateOfBirth}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>Paese di origine</Text>
            <Text style={styles.value}>{c.countryOfOrigin || "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Indirizzo</Text>
            <Text style={styles.value}>{c.address || "—"}</Text>
          </View>
          {c.phone && (
            <View style={styles.row}>
              <Text style={styles.label}>Telefono</Text>
              <Text style={styles.value}>{c.phone}</Text>
            </View>
          )}
          {c.legalStatus && (
            <View style={styles.row}>
              <Text style={styles.label}>Stato legale</Text>
              <Text style={styles.value}>{c.legalStatus}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>Permesso di lavoro</Text>
            <Text style={styles.value}>{c.workingPermit ? "Sì" : "No"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Patente</Text>
            <Text style={styles.value}>{c.drivingLicense ? "Sì" : "No"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Canale</Text>
            <Text style={styles.value}>{c.channel}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Data registrazione</Text>
            <Text style={styles.value}>
              {c.createdAt.toLocaleDateString("it-IT")}
            </Text>
          </View>
        </View>

        {/* Lingue */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Lingue</Text>
          {c.languages.language ? (
            <Text style={styles.listItem}>
              {"\u2022"} Lingua madre: {c.languages.language}
            </Text>
          ) : (
            <Text style={styles.listItem}>Nessuna lingua indicata</Text>
          )}
          {c.languages.additionalLanguages && (
            <Text style={styles.listItem}>
              {"\u2022"} Altre: {c.languages.additionalLanguages}
            </Text>
          )}
        </View>

        {/* Formazione */}
        {c.educationAndTraining.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Formazione</Text>
            {c.educationAndTraining.map((item, i) => (
              <Text key={i} style={styles.listItem}>
                {"\u2022"} {item}
              </Text>
            ))}
          </View>
        )}

        {/* Competenze */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Competenze</Text>
          {c.skillsAndCompetences.length > 0 ? (
            c.skillsAndCompetences.map((skill, i) => (
              <Text key={i} style={styles.listItem}>
                {"\u2022"} {skill}
              </Text>
            ))
          ) : (
            <Text style={styles.listItem}>Nessuna competenza indicata</Text>
          )}
        </View>

        {/* Esperienze lavorative */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Esperienze lavorative</Text>
          {c.workExperience.length > 0 ? (
            c.workExperience.map((exp, i) => (
              <Text key={i} style={styles.listItem}>
                {"\u2022"} {exp}
              </Text>
            ))
          ) : (
            <Text style={styles.listItem}>Nessuna esperienza indicata</Text>
          )}
        </View>

        {/* Preferenze lavorative */}
        {c.jobPreferences.desiredJob && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Preferenze lavorative</Text>
            <View style={styles.row}>
              <Text style={styles.label}>Lavoro desiderato</Text>
              <Text style={styles.value}>{c.jobPreferences.desiredJob}</Text>
            </View>
            {c.jobPreferences.preferredLocation && (
              <View style={styles.row}>
                <Text style={styles.label}>Zona preferita</Text>
                <Text style={styles.value}>{c.jobPreferences.preferredLocation}</Text>
              </View>
            )}
            <View style={styles.row}>
              <Text style={styles.label}>Orario</Text>
              <Text style={styles.value}>
                {c.jobPreferences.partTimePreference ? "Part-time" : "Full-time"}
              </Text>
            </View>
          </View>
        )}

        {/* Note */}
        {notes.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Note</Text>
            {notes.map((note, i) => (
              <View key={i} style={styles.noteBlock}>
                <Text style={styles.noteAuthor}>
                  {note.userName} -{" "}
                  {note.createdAt.toLocaleDateString("it-IT")}
                </Text>
                <Text style={styles.noteContent}>{note.content}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.footer}>
          Kubri S.r.l. - Documento generato automaticamente
        </Text>
      </Page>
    </Document>
  );
}
