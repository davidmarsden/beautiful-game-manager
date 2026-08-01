#!/usr/bin/env bash
set -euo pipefail

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

make_bundle() {
  local root="$1"
  local project_ref="$2"
  local schema_extra="${3:-}"
  local bundle="$root/tbg-supabase-20260801T000000Z-test"
  mkdir -p "$bundle"
  printf 'CREATE TABLE public.example(id integer);\n%s\n' "$schema_extra" > "$bundle/schema.sql"
  printf 'COPY public.example (id) FROM stdin;\n1\n\\.\n' > "$bundle/data.sql"
  printf 'CREATE ROLE example;\n' > "$bundle/roles.sql"
  printf 'supabase version\n' > "$bundle/supabase-cli-version.txt"
  cat > "$bundle/manifest.txt" <<EOF
project_ref=${project_ref}
created_at_utc=20260801T000000Z
EOF
  (
    cd "$bundle"
    sha256sum roles.sql schema.sql data.sql supabase-cli-version.txt manifest.txt > SHA256SUMS
  )
}

valid="$tmp/valid"
make_bundle "$valid" edarvglbzuefveqcjpdt 'GRANT EXECUTE ON FUNCTION public.example() TO service_role;'
bash scripts/security/verify-supabase-logical-backup.sh "$valid"

wrong="$tmp/wrong"
make_bundle "$wrong" xxntutejknolhmbssqdf
if bash scripts/security/verify-supabase-logical-backup.sh "$wrong"; then
  echo 'Expected wrong-project backup verification to fail' >&2
  exit 1
fi

secret="$tmp/secret"
make_bundle "$secret" edarvglbzuefveqcjpdt "-- postgresql://postgres.edarvglbzuefveqcjpdt:secret@example.invalid:5432/postgres"
(
  cd "$secret"/tbg-supabase-*
  sha256sum roles.sql schema.sql data.sql supabase-cli-version.txt manifest.txt > SHA256SUMS
)
if bash scripts/security/verify-supabase-logical-backup.sh "$secret"; then
  echo 'Expected embedded connection URL verification to fail' >&2
  exit 1
fi

SUPABASE_DB_URL='postgresql://postgres.edarvglbzuefveqcjpdt:secret@aws-0-eu-west-2.pooler.supabase.com:5432/postgres' \
  bash scripts/security/create-supabase-logical-backup.sh --validate-only

SUPABASE_DB_URL='postgresql://postgres:secret@db.edarvglbzuefveqcjpdt.supabase.co:5432/postgres' \
  bash scripts/security/create-supabase-logical-backup.sh --validate-only

if SUPABASE_DB_URL='postgresql://postgres.edarvglbzuefveqcjpdt:secret@evil.example:5432/postgres' \
  bash scripts/security/create-supabase-logical-backup.sh --validate-only; then
  echo 'Expected non-Supabase pooler host validation to fail' >&2
  exit 1
fi

if SUPABASE_DB_URL='postgresql://postgres.edarvglbzuefveqcjpdt:secret@aws-0-eu-west-2.pooler.supabase.com:5432/postgres?host=evil.example' \
  bash scripts/security/create-supabase-logical-backup.sh --validate-only; then
  echo 'Expected connection parameter override validation to fail' >&2
  exit 1
fi

printf 'Backup verifier regression tests passed.\n'
