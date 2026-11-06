#!/bin/sh
# Runs once, on first container start (docker-entrypoint-initdb.d).
set -e

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE kubri_bot_test"

for db in "$POSTGRES_DB" kubri_bot_test; do
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$db" \
    -f /docker-entrypoint-initdb.d/sql/dashboard-sim.sql
done
