import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/candidates/status-badge";
import type { Candidate } from "@/types";
import {
  Globe,
  MapPin,
  Clock,
  MessageSquare,
  Calendar,
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

function formatAvailability(availability: Candidate["availability"]): string {
  switch (availability) {
    case "immediate":
      return "Immediata";
    case "within_1_month":
      return "Entro 1 mese";
    default:
      return "Altro";
  }
}

function formatChannel(channel: Candidate["channel"]): string {
  switch (channel) {
    case "telegram":
      return "Telegram";
    case "whatsapp":
      return "WhatsApp";
    default:
      return channel;
  }
}

export function CandidateProfile({ candidate }: CandidateProfileProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {candidate.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Registrato il {formatDate(candidate.createdAt)}
          </p>
        </div>
        <StatusBadge status={candidate.interviewStatus} />
      </div>

      {/* Info Fields */}
      <Card>
        <CardHeader>
          <CardTitle>Informazioni generali</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Nazionalità:</span>
              <span className="text-sm">{candidate.nationality || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Città:</span>
              <span className="text-sm">{candidate.city || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Disponibilità:</span>
              <span className="text-sm">
                {formatAvailability(candidate.availability)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Canale:</span>
              <span className="text-sm">
                {formatChannel(candidate.channel)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Ultimo aggiornamento:</span>
              <span className="text-sm">{formatDate(candidate.updatedAt)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Languages */}
      {candidate.languages.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Lingue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {candidate.languages.map((lang) => (
                <Badge key={lang} variant="secondary">
                  {lang}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Skills */}
      {candidate.skills.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Competenze</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {candidate.skills.map((skill) => (
                <Badge key={skill} variant="outline">
                  {skill}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Work Experiences */}
      {candidate.workExperiences.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Esperienze lavorative</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {candidate.workExperiences.map((exp, idx) => (
                <li key={idx} className="border-l-2 border-muted-foreground/25 pl-3">
                  <p className="text-sm font-semibold">{exp.role}</p>
                  {exp.description && (
                    <p className="text-sm text-muted-foreground">
                      {exp.description}
                    </p>
                  )}
                  {exp.duration && (
                    <p className="text-xs text-muted-foreground/75">
                      {exp.duration}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
