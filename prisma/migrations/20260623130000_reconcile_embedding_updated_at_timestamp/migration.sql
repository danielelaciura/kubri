-- Reconcile the embeddingUpdatedAt drift.
--
-- The pgvector migration (20260513092609_pgvector_embeddings) created
-- Candidate.embeddingUpdatedAt and JobDescription.embeddingUpdatedAt as
-- `timestamptz` via raw SQL. Every other DateTime column in the project uses
-- Prisma's default `timestamp(3)`, and schema.prisma declares these two as a
-- plain `DateTime?` (-> timestamp(3)). The migration history was therefore the
-- only thing still saying `timestamptz`, producing a persistent drift on
-- `prisma migrate dev`.
--
-- Converge on the project convention: timestamp(3). Convert explicitly via
-- `AT TIME ZONE 'UTC'` so the stored wall-clock instant is preserved on any DB
-- that still holds the timestamptz type (prod). On a DB already on timestamp(3)
-- (dev) this is effectively a no-op. The column is only used for staleness
-- comparisons and is mostly NULL, so the conversion is safe.
ALTER TABLE "Candidate"
  ALTER COLUMN "embeddingUpdatedAt" TYPE TIMESTAMP(3)
  USING ("embeddingUpdatedAt" AT TIME ZONE 'UTC');

ALTER TABLE "JobDescription"
  ALTER COLUMN "embeddingUpdatedAt" TYPE TIMESTAMP(3)
  USING ("embeddingUpdatedAt" AT TIME ZONE 'UTC');
