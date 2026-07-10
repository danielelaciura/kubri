-- Support the broadened candidate-visibility predicate
-- (`poolId IN (...) OR sharedWithGlobal = true`): candidates flagged
-- sharedWithGlobal are now visible to every client organization, so reads OR in
-- `sharedWithGlobal = true`, which the existing poolId indexes cannot serve.
--
-- Partial index: shared candidates are the minority, so this stays small and
-- Postgres can bitmap-OR it with the poolId index scan. Partial indexes are not
-- expressible in schema.prisma (same as the pool_only_one_global partial unique
-- index) — this lives only in the migration. A later `prisma migrate dev` may
-- emit a spurious DROP INDEX for it; strip that line and apply with
-- `migrate deploy`.
CREATE INDEX "Candidate_sharedWithGlobal_idx"
  ON "Candidate" ("sharedWithGlobal")
  WHERE "sharedWithGlobal" = true;
