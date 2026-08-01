#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL must be set}"

expected_project_ref="edarvglbzuefveqcjpdt"
source_project_ref=""

if [[ "$SUPABASE_DB_URL" == *\?* || "$SUPABASE_DB_URL" == *\#* ]]; then
  echo "SUPABASE_DB_URL must not contain query parameters or fragments." >&2
  exit 1
fi

if [[ "$SUPABASE_DB_URL" =~ ^postgres(ql)?://postgres\.([a-z0-9]+):[^@]+@([^/:]+)(:[0-9]+)?/postgres$ ]]; then
  source_project_ref="${BASH_REMATCH[2]}"
  source_host="${BASH_REMATCH[3]}"

  if [[ ! "$source_host" =~ ^[a-z0-9-]+\.pooler\.supabase\.com$ ]]; then
    echo "Refusing non-Supabase pooler host: $source_host" >&2
    exit 1
  fi
elif [[ "$SUPABASE_DB_URL" =~ ^postgres(ql)?://postgres:[^@]+@db\.([a-z0-9]+)\.supabase\.co(:[0-9]+)?/postgres$ ]]; then
  source_project_ref="${BASH_REMATCH[2]}"
else
  echo "Could not validate SUPABASE_DB_URL as a Supabase Session pooler or direct database URL." >&2
  exit 1
fi

if [ "$source_project_ref" != "$expected_project_ref" ]; then
  echo "Refusing to back up Supabase project $source_project_ref; expected $expected_project_ref." >&2
  exit 1
fi

if [ "${1:-}" = "--validate-only" ]; then
  printf 'Validated Supabase database URL for project %s.\n' "$source_project_ref"
  exit 0
fi

output_dir="${1:-backup}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
label="${BACKUP_LABEL:-manual}"
safe_label="$(printf '%s' "$label" | tr -cs 'A-Za-z0-9._-' '-' | sed 's/^-//;s/-$//')"
safe_label="${safe_label:-manual}"
bundle_dir="${output_dir}/tbg-supabase-${timestamp}-${safe_label}"

mkdir -p "$bundle_dir"
umask 077

supabase --version > "$bundle_dir/supabase-cli-version.txt"

supabase db dump \
  --db-url "$SUPABASE_DB_URL" \
  --file "$bundle_dir/roles.sql" \
  --role-only

supabase db dump \
  --db-url "$SUPABASE_DB_URL" \
  --file "$bundle_dir/schema.sql"

supabase db dump \
  --db-url "$SUPABASE_DB_URL" \
  --file "$bundle_dir/data.sql" \
  --use-copy \
  --data-only \
  --exclude "storage.buckets_vectors" \
  --exclude "storage.vector_indexes"

cat > "$bundle_dir/manifest.txt" <<EOF
project_ref=${source_project_ref}
created_at_utc=${timestamp}
label=${label}
backup_type=supabase_cli_logical
includes=roles,schema,non_managed_data
excludes=supabase_managed_auth_storage_extension_schemas,storage.buckets_vectors,storage.vector_indexes
source_commit=${GITHUB_SHA:-local}
workflow_run=${GITHUB_RUN_ID:-local}
EOF

(
  cd "$bundle_dir"
  sha256sum roles.sql schema.sql data.sql supabase-cli-version.txt manifest.txt > SHA256SUMS
)

printf 'Created backup bundle for project %s: %s\n' "$source_project_ref" "$bundle_dir"
