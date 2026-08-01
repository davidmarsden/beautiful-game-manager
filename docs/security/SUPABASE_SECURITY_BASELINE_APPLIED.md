# Supabase security privilege baseline

Applied to production: 2026-08-01
Project: `edarvglbzuefveqcjpdt`

## Protection applied

- future public-schema functions no longer receive automatic execute grants for `anon` or `authenticated`;
- future public-schema tables and sequences no longer receive automatic broad grants for `anon` or `authenticated`;
- `current_manager_id()` is no longer anonymous, while retaining the authenticated access required by existing RLS policies;
- `get_manager_portal_world_fragment(text, text)` is service-role-only;
- auth trigger, submission-lock, transfer trigger and RLS event-trigger functions are no longer exposed as ordinary RPCs;
- deterministic helper functions now use fixed `search_path` settings;
- `match_runs` has no ordinary table grants and an explicit deny-all RLS policy for `anon` and `authenticated`;
- `manager_profiles` has no anonymous privileges;
- signed-in managers can select their own profile through existing RLS and update only `display_name`, `country`, `timezone`, `favourite_club`, `profile_completed` and `updated_at`;
- `user_id`, `email`, `status`, `is_admin`, identity and audit fields remain service-controlled;
- Netlify secret scanning no longer excludes `SUPABASE_SERVICE_ROLE_KEY`.

## Validation performed

Before application, the full privilege migration ran inside a transaction ending in `ROLLBACK` and returned:

`security_baseline_validated_without_commit`

After application, an authenticated-role smoke test confirmed:

- `current_manager_id()` resolves the expected manager from `auth.uid()`;
- the manager can read their own profile;
- editable profile fields remain writable;
- `is_admin`, `status` and `user_id` are not writable.

A service-role smoke test confirmed that the Netlify portal path can still call `get_manager_portal_world_fragment()` and receive a valid object.

Result:

`security_baseline_smoke_tests_passed`

## Supabase advisor delta

Resolved advisories:

- anonymous execution of internal `SECURITY DEFINER` functions;
- authenticated execution of internal trigger and maintenance functions;
- mutable `search_path` on `manager_command_subject_key`;
- mutable `search_path` on `tbg_canonical_jsonb_text`;
- RLS enabled with no policy on `match_runs`.

Remaining advisories are intentional manager-facing `SECURITY DEFINER` RPCs requiring a later trust-boundary redesign, plus the dashboard setting for leaked-password protection.

## Rollback

Use `supabase/rollback/20260801_security_privilege_baseline_rollback.sql` only for emergency availability recovery. It deliberately restores the insecure pre-baseline privilege state.
