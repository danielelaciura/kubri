-- Crea il pool "Global"
INSERT INTO "Pool" (id, name, slug, "isGlobal", "externalKey", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'Global', 'global', true, NULL, NOW(), NOW());

-- Crea un Pool per ogni makeDatastoreId distinto su Organization
INSERT INTO "Pool" (id, name, slug, "externalKey", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  'Pool ' || md,
  md,
  md,
  NOW(),
  NOW()
FROM (SELECT DISTINCT "makeDatastoreId" AS md FROM "Organization") src;

-- Aggancia ogni org al suo pool dedicato (matched per externalKey)
INSERT INTO "OrganizationPool" ("organizationId", "poolId", "createdAt")
SELECT o.id, p.id, NOW()
FROM "Organization" o
JOIN "Pool" p ON p."externalKey" = o."makeDatastoreId";

-- Aggancia ogni org anche al pool "Global"
INSERT INTO "OrganizationPool" ("organizationId", "poolId", "createdAt")
SELECT o.id, (SELECT id FROM "Pool" WHERE "isGlobal" = true), NOW()
FROM "Organization" o
ON CONFLICT DO NOTHING;

-- Backfill Candidate.poolId via Pool.externalKey
UPDATE "Candidate" c
SET "poolId" = p.id
FROM "Pool" p
WHERE p."externalKey" = c."makeDatastoreId";

-- Verifica integrità: nessun candidato con poolId NULL
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Candidate" WHERE "poolId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incompleto: ci sono candidati senza poolId';
  END IF;
END $$;
