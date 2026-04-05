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
    width: 120,
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
  experienceBlock: {
    marginBottom: 8,
    padding: 8,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 4,
  },
  experienceRole: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    marginBottom: 2,
  },
  experienceDesc: {
    fontSize: 9,
    color: GRAY,
  },
  transcriptEntry: {
    marginBottom: 8,
  },
  question: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: BLUE,
    marginBottom: 2,
  },
  answer: {
    fontSize: 9,
    color: "#374151",
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

function availabilityLabel(a: string): string {
  switch (a) {
    case "immediate":
      return "Immediata";
    case "within_1_month":
      return "Entro 1 mese";
    default:
      return "Altro";
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case "completed":
      return "Completata";
    case "in_progress":
      return "In corso";
    case "abandoned":
      return "Abbandonata";
    default:
      return "Incompleta";
  }
}

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

        <Text style={styles.candidateName}>{c.name}</Text>

        {/* Informazioni personali */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Informazioni personali</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Nazionalità</Text>
            <Text style={styles.value}>{c.nationality}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Città</Text>
            <Text style={styles.value}>{c.city}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Disponibilità</Text>
            <Text style={styles.value}>{availabilityLabel(c.availability)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Stato intervista</Text>
            <Text style={styles.value}>{statusLabel(c.interviewStatus)}</Text>
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
          {c.languages.length > 0 ? (
            c.languages.map((lang, i) => (
              <Text key={i} style={styles.listItem}>
                {"\u2022"} {lang}
              </Text>
            ))
          ) : (
            <Text style={styles.listItem}>Nessuna lingua indicata</Text>
          )}
        </View>

        {/* Competenze */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Competenze</Text>
          {c.skills.length > 0 ? (
            c.skills.map((skill, i) => (
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
          {c.workExperiences.length > 0 ? (
            c.workExperiences.map((exp, i) => (
              <View key={i} style={styles.experienceBlock}>
                <Text style={styles.experienceRole}>
                  {exp.role}
                  {exp.duration ? ` (${exp.duration})` : ""}
                </Text>
                <Text style={styles.experienceDesc}>{exp.description}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.listItem}>Nessuna esperienza indicata</Text>
          )}
        </View>

        {/* Trascrizione intervista */}
        {c.interviewTranscript.length > 0 && (
          <View style={styles.section} break>
            <Text style={styles.sectionTitle}>Trascrizione intervista</Text>
            {c.interviewTranscript.map((entry, i) => (
              <View key={i} style={styles.transcriptEntry}>
                <Text style={styles.question}>D: {entry.question}</Text>
                <Text style={styles.answer}>R: {entry.answer}</Text>
              </View>
            ))}
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
