CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "Candidate"
  ADD COLUMN "embedding"          vector(384),
  ADD COLUMN "embeddingText"      text,
  ADD COLUMN "embeddingUpdatedAt" timestamptz;

ALTER TABLE "JobDescription"
  ADD COLUMN "embedding"          vector(384),
  ADD COLUMN "embeddingText"      text,
  ADD COLUMN "embeddingUpdatedAt" timestamptz;

CREATE INDEX "Candidate_embedding_hnsw_idx"
  ON "Candidate" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX "JobDescription_embedding_hnsw_idx"
  ON "JobDescription" USING hnsw (embedding vector_cosine_ops);
