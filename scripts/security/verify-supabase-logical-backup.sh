#!/usr/bin/env bash
set -euo pipefail

root="${1:-backup}"
bundle_dir="$(find "$root" -mindepth 1 -maxdepth 1 -type d -name 'tbg-supabase-*' | sort | tail -n 1)"

if [ -z "$bundle_dir" ]; then
  echo "No backup bundle found beneath $root" >&2
  exit 1
fi

required=(roles.sql schema.sql data.sql manifest.txt supabase-cli-version.txt SHA256SUMS)
for file in "${required[@]}"; do
  if [ ! -s "$bundle_dir/$file" ]; then
    echo "Missing or empty backup file: $bundle_dir/$file" >&2
    exit 1
  fi
done

(
  cd "$bundle_dir"
  sha256sum --check SHA256SUMS
)

grep -Eq 'CREATE|ALTER|COMMENT|GRANT|REVOKE' "$bundle_dir/schema.sql" || {
  echo "schema.sql does not contain expected schema statements" >&2
  exit 1
}

grep -Eq 'COPY|INSERT INTO' "$bundle_dir/data.sql" || {
  echo "data.sql does not contain expected data statements" >&2
  exit 1
}

grep -q '^project_ref=edarvglbzuefveqcjpdt$' "$bundle_dir/manifest.txt" || {
  echo "Backup manifest targets the wrong Supabase project" >&2
  exit 1
}

if grep -RIlE '(service_role|SUPABASE_DB_URL|postgresql://[^[:space:]]+:[^[:space:]]+@)' "$bundle_dir" >/dev/null; then
  echo "A backup output appears to contain a connection secret or service-role marker" >&2
  exit 1
fi

printf 'Verified logical backup bundle: %s\n' "$bundle_dir"
printf 'Important: Supabase CLI dumps exclude managed auth, storage and extension schemas by default.\n'
