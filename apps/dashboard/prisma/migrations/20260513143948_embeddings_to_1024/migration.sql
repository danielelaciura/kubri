-- Switch embedding dimension from gte-small (384) to mistral-embed (1024).
-- The vector type doesn't allow in-place dimension change; we drop the
-- column (and its index) and re-add it. Existing embeddings are
-- irrecoverable at the new dim and must be regenerated via backfill.

DROP INDEX IF EXISTS "Candidate_embedding_hnsw_idx";
DROP INDEX IF EXISTS "JobDescription_embedding_hnsw_idx";

ALTER TABLE "Candidate" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "Candidate" ADD COLUMN "embedding" vector(1024);
UPDATE "Candidate" SET "embeddingText" = NULL, "embeddingUpdatedAt" = NULL;

ALTER TABLE "JobDescription" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "JobDescription" ADD COLUMN "embedding" vector(1024);
UPDATE "JobDescription" SET "embeddingText" = NULL, "embeddingUpdatedAt" = NULL;

CREATE INDEX "Candidate_embedding_hnsw_idx"
  ON "Candidate" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX "JobDescription_embedding_hnsw_idx"
  ON "JobDescription" USING hnsw (embedding vector_cosine_ops);
