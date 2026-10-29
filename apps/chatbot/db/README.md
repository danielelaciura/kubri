# Ruoli database

Il bot condivide il Postgres della dashboard Kubri (stesso progetto Supabase), ma vive solo
negli schemi `bot` e `bot_queue` (spec §10).

## Applicazione (una volta per progetto Supabase)

1. Generare due password robuste e salvarle nel gestore dei segreti.
2. Eseguire `db/roles.sql` come utente `postgres` sull'URL diretto (porta 5432).
3. Verificare l'isolamento:

   ```sql
   SET ROLE bot_app;
   SELECT 1 FROM public."Candidate" LIMIT 1;   -- atteso: permission denied
   SELECT 1 FROM bot."Organization" LIMIT 1;    -- atteso: OK (dopo le migrazioni)
   RESET ROLE;
   ```

## Stringhe di connessione

- **Migrazioni** (`bot_migrator`) e **runtime** (`bot_app`): usare la connessione diretta o il
  _session pooler_ (porta 5432). pg-boss e i lock advisory non funzionano con il transaction
  pooler (6543).
- Con il pooler Supabase l'utente ha la forma `bot_app.<project-ref>`.
- Aggiungere sempre `?schema=bot` all'URL usato da Prisma.
