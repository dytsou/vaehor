#!/usr/bin/env bash
# Integration test for scripts/entrypoint.sh against a live Postgres instance.
#
# Prerequisites:
#   - Postgres reachable (e.g. pnpm deps:up)
#   - psql client
#   - global prisma@7.7.0 in PATH (matches Dockerfile runner stage)
#
# Env overrides: PGHOST PGPORT PGUSER PGPASSWORD
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${ROOT}/node_modules/.bin:${PATH}"

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
export PGPASSWORD

DB_NAME="entrypoint_test_${$}_${RANDOM}"

fail() {
  echo "entrypoint integration: $*" >&2
  exit 1
}

command -v psql >/dev/null 2>&1 || fail "psql not found — install postgresql-client"
command -v prisma >/dev/null 2>&1 ||
  fail "prisma not found — run: pnpm install (or npm install -g prisma@7.7.0)"

if ! psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -c '\q' 2>/dev/null; then
  fail "Postgres not reachable at ${PGHOST}:${PGPORT} — run: pnpm deps:up"
fi

drop_test_db() {
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";" >/dev/null 2>&1 || true
}

trap drop_test_db EXIT
drop_test_db

DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}?schema=public"
export DATABASE_URL

run_entrypoint() {
  sh scripts/entrypoint.sh echo ENTRYPOINT_OK
}

output="$(run_entrypoint 2>&1)" || fail "entrypoint failed on first run"
echo "$output" | grep -q ENTRYPOINT_OK || fail "stub command output missing on first run"

migration_count="$(
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -tAc \
    'SELECT COUNT(*) FROM "_prisma_migrations"' 2>/dev/null || true
)"
[[ "${migration_count:-0}" -ge 1 ]] ||
  fail "expected _prisma_migrations rows after first run, got: ${migration_count:-0}"

user_table="$(
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -tAc \
    "SELECT to_regclass('public.\"User\"') IS NOT NULL" 2>/dev/null || true
)"
[[ "$user_table" == "t" ]] || fail "User table not created after migrations"

output2="$(run_entrypoint 2>&1)" || fail "entrypoint failed on second run (idempotency)"
echo "$output2" | grep -q ENTRYPOINT_OK ||
  fail "stub command output missing on second run"

echo "entrypoint integration: OK"
