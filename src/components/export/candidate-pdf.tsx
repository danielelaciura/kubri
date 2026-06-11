import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { Candidate } from "@/types";
import type { Dictionary } from "@/lib/i18n";

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
  dictionary: Dictionary;
}

export function renderCandidatePdf({ candidate, notes, dictionary }: CandidatePdfProps) {
  const c = candidate;
  const d = dictionary;
  const locale = "it-IT";
  const exportDate = new Date().toLocaleDateString(locale);

  // Strip trailing colon/space from reused candidates.* labels (they carry ":" for the detail view)
  const strip = (s: string) => s.replace(/:\s*$/, "");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>Kubri</Text>
          <Text style={styles.dateText}>{d.pdf.exportedOn} {exportDate}</Text>
        </View>

        <Text style={styles.candidateName}>
          {c.firstName} {c.lastName}
        </Text>

        {/* Personal information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{d.candidates.personalInfo}</Text>
          {c.dateOfBirth && (
            <View style={styles.row}>
              <Text style={styles.label}>{strip(d.candidates.dateOfBirth)}</Text>
              <Text style={styles.value}>{c.dateOfBirth}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>{strip(d.candidates.countryOfOrigin)}</Text>
            <Text style={styles.value}>{c.countryOfOrigin || "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{strip(d.candidates.address)}</Text>
            <Text style={styles.value}>{c.address || "—"}</Text>
          </View>
          {c.phone && (
            <View style={styles.row}>
              <Text style={styles.label}>{strip(d.candidates.phone)}</Text>
              <Text style={styles.value}>{c.phone}</Text>
            </View>
          )}
          {c.legalStatus && (
            <View style={styles.row}>
              <Text style={styles.label}>{strip(d.candidates.legalStatus)}</Text>
              <Text style={styles.value}>{c.legalStatus}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>{strip(d.candidates.workingPermit)}</Text>
            <Text style={styles.value}>{c.workingPermit ? d.candidates.workingPermitYes : d.candidates.workingPermitNo}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{strip(d.candidates.drivingLicense)}</Text>
            <Text style={styles.value}>{c.drivingLicense ? d.candidates.drivingLicenseYes : d.candidates.drivingLicenseNo}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{strip(d.candidates.channel)}</Text>
            <Text style={styles.value}>{c.channel}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{d.pdf.registeredOn}</Text>
            <Text style={styles.value}>
              {c.createdAt.toLocaleDateString(locale)}
            </Text>
          </View>
        </View>

        {/* Languages */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{d.candidates.languages}</Text>
          {c.languages.language ? (
            <Text style={styles.listItem}>
              {"•"} {strip(d.candidates.motherTongue)} {c.languages.language}
            </Text>
          ) : (
            <Text style={styles.listItem}>{d.pdf.noLanguages}</Text>
          )}
          {c.languages.additionalLanguages && (
            <Text style={styles.listItem}>
              {"•"} {d.pdf.otherLanguages}{c.languages.additionalLanguages}
            </Text>
          )}
        </View>

        {/* Education */}
        {c.educationAndTraining.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{d.candidates.education}</Text>
            {c.educationAndTraining.map((item, i) => (
              <Text key={i} style={styles.listItem}>
                {"•"} {item}
              </Text>
            ))}
          </View>
        )}

        {/* Skills */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{d.candidates.skills}</Text>
          {c.skillsAndCompetences.length > 0 ? (
            c.skillsAndCompetences.map((skill, i) => (
              <Text key={i} style={styles.listItem}>
                {"•"} {skill}
              </Text>
            ))
          ) : (
            <Text style={styles.listItem}>{d.pdf.noSkills}</Text>
          )}
        </View>

        {/* Work experience */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{d.candidates.workExperience}</Text>
          {c.workExperience.length > 0 ? (
            c.workExperience.map((exp, i) => (
              <Text key={i} style={styles.listItem}>
                {"•"} {exp}
              </Text>
            ))
          ) : (
            <Text style={styles.listItem}>{d.pdf.noExperience}</Text>
          )}
        </View>

        {/* Job preferences */}
        {c.jobPreferences.desiredJob && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{d.candidates.jobPreferences}</Text>
            <View style={styles.row}>
              <Text style={styles.label}>{strip(d.candidates.desiredJob)}</Text>
              <Text style={styles.value}>{c.jobPreferences.desiredJob}</Text>
            </View>
            {c.jobPreferences.preferredLocation && (
              <View style={styles.row}>
                <Text style={styles.label}>{strip(d.candidates.preferredLocation)}</Text>
                <Text style={styles.value}>{c.jobPreferences.preferredLocation}</Text>
              </View>
            )}
            <View style={styles.row}>
              <Text style={styles.label}>{d.pdf.schedule}</Text>
              <Text style={styles.value}>
                {c.jobPreferences.partTimePreference ? d.candidates.partTime : d.candidates.fullTime}
              </Text>
            </View>
          </View>
        )}

        {/* Notes */}
        {notes.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{d.pdf.notes}</Text>
            {notes.map((note, i) => (
              <View key={i} style={styles.noteBlock}>
                <Text style={styles.noteAuthor}>
                  {note.userName} -{" "}
                  {note.createdAt.toLocaleDateString(locale)}
                </Text>
                <Text style={styles.noteContent}>{note.content}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.footer}>
          {d.pdf.footerText}
        </Text>
      </Page>
    </Document>
  );
}
