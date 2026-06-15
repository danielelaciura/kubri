import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Candidate } from "@/types";
import {
  Globe,
  MapPin,
  Phone,
  Calendar,
  Car,
  Briefcase,
  GraduationCap,
  FileText,
} from "lucide-react";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n";
import { displayCountry } from "@/lib/candidates/country";

interface CandidateProfileProps {
  candidate: Candidate;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export async function CandidateProfile({ candidate }: CandidateProfileProps) {
  const locale = await getServerLocale();
  const t = getDictionary(locale);
  const c = candidate;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl tracking-tight">
            {c.firstName} {c.lastName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.candidates.registeredOn} {formatDate(c.createdAt)}
          </p>
        </div>
      </div>

      {/* Informazioni personali */}
      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>{t.candidates.personalInfo}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {c.dateOfBirth && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t.candidates.dateOfBirth}</span>
                <span className="text-sm">{c.dateOfBirth}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t.candidates.countryOfOrigin}</span>
              <span className="text-sm">{displayCountry(c.countryOfOrigin, locale) || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t.candidates.address}</span>
              <span className="text-sm">{c.address || "—"}</span>
            </div>
            {c.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t.candidates.phone}</span>
                <span className="text-sm">{c.phone}</span>
              </div>
            )}
            {c.legalStatus && (
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t.candidates.legalStatus}</span>
                <span className="text-sm">{c.legalStatus}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t.candidates.workingPermit}</span>
              <span className="text-sm">{c.workingPermit ? t.candidates.workingPermitYes : t.candidates.workingPermitNo}</span>
            </div>
            {c.meanOfTransport && (
              <div className="flex items-center gap-2">
                <Car className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t.candidates.meanOfTransport}</span>
                <span className="text-sm">{c.meanOfTransport}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Car className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t.candidates.drivingLicense}</span>
              <span className="text-sm">{c.drivingLicense ? t.candidates.drivingLicenseYes : t.candidates.drivingLicenseNo}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lingue */}
      {(c.languages.language || c.languages.additionalLanguages) && (
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>{t.candidates.languages}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {c.languages.language && (
                <div>
                  <span className="text-sm font-medium">{t.candidates.motherTongue}</span>
                  <Badge variant="secondary" className="capitalize">{c.languages.language}</Badge>
                </div>
              )}
              {c.languages.additionalLanguages && (
                <div>
                  <span className="text-sm font-medium">{t.candidates.otherLanguages}</span>
                  {c.languages.additionalLanguages.map((language) => (
                    <Badge key={language} variant="secondary" className="capitalize">
                      {language}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Formazione */}
      {c.educationAndTraining.length > 0 && (
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>{t.candidates.education}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {c.educationAndTraining.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <GraduationCap className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Competenze */}
      {c.skillsAndCompetences.length > 0 && (
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>{t.candidates.skills}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {c.skillsAndCompetences.map((skill) => (
                <Badge key={skill} variant="outline">
                  {skill}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Esperienze lavorative */}
      {c.workExperience.length > 0 && (
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>{t.candidates.workExperience}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {c.workExperience.map((exp, idx) => (
                <li key={idx} className="border-l-2 border-muted-foreground/25 pl-3">
                  <p className="text-sm">{exp}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Preferenze lavorative */}
      {(c.jobPreferences.desiredJob ||
        c.jobPreferences.preferredLocation ||
        c.jobPreferences.constraints ||
        c.jobPreferences.hasDesiredJobExperience) && (
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>{t.candidates.jobPreferences}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {c.jobPreferences.desiredJob && (
                <div>
                  <span className="text-sm font-medium">{t.candidates.desiredJob}</span>
                  <span className="text-sm">{c.jobPreferences.desiredJob}</span>
                </div>
              )}
              {c.jobPreferences.preferredLocation && (
                <div>
                  <span className="text-sm font-medium">{t.candidates.preferredLocation}</span>
                  <span className="text-sm">{c.jobPreferences.preferredLocation}</span>
                </div>
              )}
              {c.jobPreferences.desiredJob && (
                <div>
                  <span className="text-sm font-medium">{t.candidates.schedulePreference}</span>
                  <span className="text-sm">
                    {c.jobPreferences.partTimePreference ? t.candidates.partTime : t.candidates.fullTime}
                  </span>
                </div>
              )}
              {c.jobPreferences.hasDesiredJobExperience && (
                <div>
                  <span className="text-sm font-medium">{t.candidates.roleExperience}</span>
                  <span className="text-sm">{c.jobPreferences.hasDesiredJobExperience}</span>
                </div>
              )}
              {c.jobPreferences.constraints && (
                <div className="sm:col-span-2">
                  <span className="text-sm font-medium">{t.candidates.constraints}</span>
                  <span className="text-sm">{c.jobPreferences.constraints}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* CV Links */}
      {(c.cvPdfLink || c.cvDocLink) && (
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>{t.candidates.cv}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              {c.cvPdfLink && (
                <a
                  href={c.cvPdfLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-kubri-600 underline hover:text-kubri-800"
                >
                  {t.candidates.cvDownloadPdf}
                </a>
              )}
              {c.cvDocLink && (
                <a
                  href={c.cvDocLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-kubri-600 underline hover:text-kubri-800"
                >
                  {t.candidates.cvOpenDoc}
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
