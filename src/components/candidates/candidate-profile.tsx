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
  MessageSquare,
  Calendar,
  Car,
  Briefcase,
  GraduationCap,
  FileText,
} from "lucide-react";

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

export function CandidateProfile({ candidate }: CandidateProfileProps) {
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
            Registrato il {formatDate(c.createdAt)}
          </p>
        </div>
      </div>

      {/* Informazioni personali */}
      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>Informazioni personali</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {c.dateOfBirth && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Data di nascita:</span>
                <span className="text-sm">{c.dateOfBirth}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Paese di origine:</span>
              <span className="text-sm">{c.countryOfOrigin || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Indirizzo:</span>
              <span className="text-sm">{c.address || "—"}</span>
            </div>
            {c.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Telefono:</span>
                <span className="text-sm">{c.phone}</span>
              </div>
            )}
            {c.legalStatus && (
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Stato legale:</span>
                <span className="text-sm">{c.legalStatus}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Permesso di lavoro:</span>
              <span className="text-sm">{c.workingPermit ? "Sì" : "No"}</span>
            </div>
            {c.meanOfTransport && (
              <div className="flex items-center gap-2">
                <Car className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Mezzo di trasporto:</span>
                <span className="text-sm">{c.meanOfTransport}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Car className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Patente:</span>
              <span className="text-sm">{c.drivingLicense ? "Sì" : "No"}</span>
            </div>
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Canale:</span>
              <span className="text-sm capitalize">{c.channel}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lingue */}
      {(c.languages.language || c.languages.additionalLanguages) && (
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>Lingue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {c.languages.language && (
                <div>
                  <span className="text-sm font-medium">Lingua madre: </span>
                  <Badge variant="secondary" className="capitalize">{c.languages.language}</Badge>
                </div>
              )}
              {c.languages.additionalLanguages && (
                <div>
                  <span className="text-sm font-medium">Altre lingue: </span>
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
            <CardTitle>Formazione</CardTitle>
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
            <CardTitle>Competenze</CardTitle>
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
            <CardTitle>Esperienze lavorative</CardTitle>
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
      {c.jobPreferences.desiredJob && (
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>Preferenze lavorative</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className="text-sm font-medium">Lavoro desiderato: </span>
                <span className="text-sm">{c.jobPreferences.desiredJob}</span>
              </div>
              {c.jobPreferences.preferredLocation && (
                <div>
                  <span className="text-sm font-medium">Zona preferita: </span>
                  <span className="text-sm">{c.jobPreferences.preferredLocation}</span>
                </div>
              )}
              <div>
                <span className="text-sm font-medium">Preferenza orario: </span>
                <span className="text-sm">
                  {c.jobPreferences.partTimePreference ? "Part-time" : "Full-time"}
                </span>
              </div>
              {c.jobPreferences.hasDesiredJobExperience && (
                <div>
                  <span className="text-sm font-medium">Esperienza nel ruolo: </span>
                  <span className="text-sm">{c.jobPreferences.hasDesiredJobExperience}</span>
                </div>
              )}
              {c.jobPreferences.constraints && (
                <div className="sm:col-span-2">
                  <span className="text-sm font-medium">Limitazioni: </span>
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
            <CardTitle>Curriculum Vitae</CardTitle>
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
                  Scarica PDF
                </a>
              )}
              {c.cvDocLink && (
                <a
                  href={c.cvDocLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-kubri-600 underline hover:text-kubri-800"
                >
                  Apri documento
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
