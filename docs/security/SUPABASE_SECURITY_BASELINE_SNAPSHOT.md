# Supabase security baseline snapshot

Captured: 2026-08-01
Project: `edarvglbzuefveqcjpdt`
Region: `eu-west-2`

This snapshot records the live state used to generate the rollback file in this branch.

## Confirmed live project

The project contains the TBG manager portal tables, including:

- `manager_profiles`
- `manager_appointments`
- `manager_messages`
- `manager_submissions`
- `match_runs`
- `canonical_world_saves`
- `manager_world_commands`
- `persistent_world_backups`
- `world_operation_events`

At capture time, all listed public tables had RLS enabled. `match_runs` had RLS enabled but no policy.

## Confirmed privilege drift

The live database allowed `anon` and `authenticated` to execute several `SECURITY DEFINER` functions that repository migrations intended to restrict, including:

- `current_manager_id()`
- `get_manager_portal_world_fragment(text, text)`
- `handle_new_auth_user()`
- `lock_expired_manager_submissions()`
- `propagate_transfer_response_outcome()`
- `rls_auto_enable()`

The exact observed grants are preserved by:

`supabase/rollback/20260801_pre_security_baseline_privileges.sql`

## Validation performed

The rollback file was executed inside a transaction against the live project and ended with `ROLLBACK`.

Result:

`rollback_sql_validated_without_commit`

This proves the referenced function signatures and privilege statements are valid PostgreSQL for the live database without changing production state.

## Current Supabase security advisories

The live advisor output still includes:

- RLS enabled with no policy on `public.match_runs`
- mutable `search_path` on `manager_command_subject_key`
- mutable `search_path` on `tbg_canonical_jsonb_text`
- anonymous execution of internal `SECURITY DEFINER` functions
- authenticated execution of manager-facing and internal `SECURITY DEFINER` functions requiring review
- leaked-password protection disabled

No security remediation was applied as part of the backup-and-rollback setup PR.
