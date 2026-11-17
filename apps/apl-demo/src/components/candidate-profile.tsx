"use client";

import type { ReactNode } from "react";
import { Avatar, Badge, Section } from "./ui";
import type { Candidate } from "@/lib/types";

/** Corpo del profilo candidato, condiviso tra vista agenzia e vista associazione. */
export function CandidateFacts({ candidate: c }: { candidate: Candidate }) {
  return (
    <Section title="Profilo">
      <dl className="grid gap-x-8 gap-y-4 p-5 text-[13px] sm:grid-cols-2">
        <Fact label="Ruoli">{c.roles.join(", ")}</Fact>
        <Fact label="Disponibilità">{c.availability}</Fact>
        <Fact label="Competenze" wide>
          <span className="mt-1 flex flex-wrap gap-1">
            {c.skills.map((s) => (
              <Badge key={s}>{s}</Badge>
            ))}
          </span>
        </Fact>
        <Fact label="Esperienza" wide>
          {c.experienceYears ? `${c.experienceYears} anni · ` : ""}
          {c.experience}
        </Fact>
        <Fact label="Italiano">{c.italian}</Fact>
        <Fact label="Altre lingue">{c.languages.join(", ")}</Fact>
        <Fact label="Patenti e attestati">{c.licenses.length ? c.licenses.join(", ") : "Nessuno"}</Fact>
        <Fact label="Età e comune">
          {c.age} anni · {c.city}
        </Fact>
      </dl>
    </Section>
  );
}

export function CandidateHeading({ candidate, name, sub, hidden }: { candidate: Candidate; name: string; sub: ReactNode; hidden?: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <span className="scale-125">
        <Avatar candidate={candidate} hidden={hidden} />
      </span>
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{name}</h1>
        <p className="text-ink-2">{sub}</p>
      </div>
    </div>
  );
}

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
