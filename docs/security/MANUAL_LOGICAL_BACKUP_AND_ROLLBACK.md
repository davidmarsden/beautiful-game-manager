# Manual Supabase logical backup and rollback

This runbook protects the live TBG Supabase project before security migrations are applied.

- Project ref: `edarvglbzuefveqcjpdt`
- Region: `eu-west-2`
- Backup mechanism: manually triggered GitHub Actions workflow
- Artifact retention: 30 days
- Database changes made by the backup workflow: none

## What the backup contains

The workflow creates a private GitHub Actions artifact containing:

- `roles.sql` — custom database roles and role grants exported by Supabase CLI
- `schema.sql` — non-managed schemas, tables, policies, functions, triggers and grants
- `data.sql` — data from non-managed schemas
- `manifest.txt` — project, timestamp, source commit and scope
- `supabase-cli-version.txt` — CLI version used for the dump
- `SHA256SUMS` — integrity checksums

Supabase CLI deliberately excludes Supabase-managed `auth`, `storage` and extension schemas from its standard logical dump. This backup is suitable protection for the planned TBG `public`-schema security migrations. It is not a replacement for a full managed Supabase physical backup, and it does not preserve Storage objects.

## One-time setup

### 1. Obtain the database connection string

In Supabase:

1. Open the TBG project.
2. Select **Connect**.
3. Choose the **Session pooler** connection string unless direct IPv6 connectivity is known to work.
4. Insert or reset the database password when prompted.
5. Copy the complete Postgres connection string.

The URL has the general form:

```text
postgresql://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:5432/postgres
```

Do not paste this URL into source code, issues, pull requests or chat.

### 2. Add the GitHub Actions secret

In `davidmarsden/beautiful-game-manager`:

1. Open **Settings → Secrets and variables → Actions**.
2. Choose **New repository secret**.
3. Name it `SUPABASE_DB_URL`.
4. Paste the complete connection string.
5. Save it.

The workflow uses the secret only as an environment variable. It is never written into the backup bundle.

## Create a backup

1. Open **Actions** in the `beautiful-game-manager` repository.
2. Select **Manual Supabase logical backup**.
3. Select **Run workflow**.
4. Optionally enter a label such as `before-security-baseline`.
5. Run the workflow from `main` after this pull request is merged.
6. Wait for the `Export roles, schema and data` job to pass.
7. Download the `tbg-supabase-logical-backup-*` artifact.
8. Store a second copy outside GitHub Actions.

A successful run verifies that:

- all expected files exist and are non-empty;
- checksums match;
- schema and data dumps contain expected SQL structures;
- the manifest identifies the correct project;
- no database URL or service-role marker appears in the generated files.

## Verify a downloaded backup

After extracting the artifact:

```bash
sha256sum --check SHA256SUMS
```

Retain the complete directory. Do not commit backup files to Git.

## Restore strategy

A full restore should normally target a new Supabase project or an isolated local Supabase stack first. Do not overwrite the live project merely to test a backup.

The documented restore order is:

```bash
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "$TARGET_DB_URL"
```

Before restoring to a new Supabase project, revoke permissive target default privileges so restored objects do not acquire broader access than the source:

```sql
alter default privileges in schema public
revoke all on tables from anon, authenticated;
```

Enable required extensions and review ownership statements before restoring. Never use the live TBG database as the first restore target.

## Security-migration rollback

`supabase/rollback/20260801_pre_security_baseline_privileges.sql` records the observed pre-hardening function privileges and relevant function configuration.

It is an emergency availability rollback, not a desirable final security state. Several grants restored by that file are precisely the grants the security programme intends to remove.

Use it only when all of the following are true:

1. a new security migration has broken the portal or scheduled processing;
2. the failure cannot be corrected immediately with a smaller forward fix;
3. the exact migration being rolled back changed only the covered function grants/configuration;
4. a fresh logical backup exists;
5. the rollback is run by an administrator in Supabase SQL Editor.

After running it:

1. smoke-test manager login, squad loading, inbox, submissions and scheduled processing;
2. rerun Supabase security advisors;
3. document the failure;
4. prepare a corrected forward migration;
5. do not leave the pre-hardening privileges in place longer than necessary.

## Rollback validation

The rollback SQL was validated against the live database inside a transaction that ended with `ROLLBACK`. This confirms that all referenced function signatures exist and that PostgreSQL accepts every grant and configuration statement without changing the committed live state.

## Limits

- GitHub Actions artifacts expire after 30 days.
- A downloaded off-platform copy is still required.
- Standard Supabase CLI dumps exclude managed Auth and Storage schemas.
- Storage files are not included.
- This process is manual and should be run before every substantial database migration while the project remains on the Free plan.
