#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL must be set}"

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
project_ref=edarvglbzuefveqcjpdt
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

printf 'Created backup bundle: %s\n' "$bundle_dir"
