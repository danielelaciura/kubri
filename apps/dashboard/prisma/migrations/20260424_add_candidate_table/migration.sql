CREATE TABLE "Candidate" (
  id                        UUID PRIMARY KEY,
  "externalId"              TEXT NOT NULL,
  "makeDatastoreId"         TEXT NOT NULL,
  "firstName"               TEXT,
  "lastName"                TEXT,
  birthday                  TEXT,
  "countryOfOrigin"         TEXT,
  address                   TEXT,
  phone                     TEXT,
  "workingPermit"           TEXT,
  "meanOfTransport"         TEXT,
  "drivingLicense"          TEXT,
  "educationAndTraining"    TEXT[] NOT NULL DEFAULT '{}',
  "workExperience"          TEXT[] NOT NULL DEFAULT '{}',
  "skillsAndCompetences"    TEXT[] NOT NULL DEFAULT '{}',
  language                  TEXT,
  "additionalLanguages"     TEXT[] NOT NULL DEFAULT '{}',
  "italianLevel"            TEXT,
  "desiredJob"              TEXT,
  "partTimePreference"      BOOLEAN,
  "preferredLocation"       TEXT,
  "jobConstraints"          TEXT,
  "hasDesiredJobExperience" TEXT,
  "interviewLanguage"       TEXT,
  "sourceOrganization"      TEXT,
  channel                   TEXT,
  "rawPayload"              JSONB NOT NULL,
  "sourceUpdatedAt"         TIMESTAMP(3),
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "Candidate_makeDatastoreId_externalId_key"
  ON "Candidate"("makeDatastoreId", "externalId");
CREATE INDEX "Candidate_makeDatastoreId_idx"
  ON "Candidate"("makeDatastoreId");
CREATE INDEX "Candidate_makeDatastoreId_createdAt_idx"
  ON "Candidate"("makeDatastoreId", "createdAt");
CREATE INDEX "Candidate_makeDatastoreId_lastName_idx"
  ON "Candidate"("makeDatastoreId", "lastName");
