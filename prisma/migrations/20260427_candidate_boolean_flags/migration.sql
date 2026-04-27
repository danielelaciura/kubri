-- Convert Candidate.workingPermit and Candidate.drivingLicense from text to
-- boolean. The Make scenario now sends these as true/false flags
-- ("ha il permesso di lavoro?", "ha la patente?") and the previous text
-- semantics ("Sì, in regola", "B + C") are no longer carried by the payload.
--
-- Safe in this branch because:
-- - prod has not yet received the Candidate table (Phase 1 not deployed)
-- - dev contains only seed/test data, which will be re-generated
--
-- Use DROP + ADD instead of ALTER ... USING to avoid invented coercions
-- on free-text values that have no meaningful boolean mapping.

ALTER TABLE "Candidate" DROP COLUMN "workingPermit";
ALTER TABLE "Candidate" ADD COLUMN "workingPermit" BOOLEAN;

ALTER TABLE "Candidate" DROP COLUMN "drivingLicense";
ALTER TABLE "Candidate" ADD COLUMN "drivingLicense" BOOLEAN;
