-- Emergency rollback for the privilege state observed on 2026-08-01.
--
-- This file intentionally restores the pre-security-baseline grants. Some of
-- those grants are the subject of Supabase security advisories. Use only to
-- recover application availability after a future hardening migration, then
-- investigate and re-apply the corrected least-privilege migration.
--
-- Target project: edarvglbzuefveqcjpdt

begin;

-- Manager identity helper used by existing RLS policies.
grant execute on function public.current_manager_id() to anon, authenticated, service_role;

-- Manager-facing RPCs.
revoke all on function public.get_managed_transfer_clubs(text) from public, anon;
grant execute on function public.get_managed_transfer_clubs(text) to authenticated, service_role;

revoke all on function public.get_manager_transfer_inbox(text) from public, anon;
grant execute on function public.get_manager_transfer_inbox(text) to authenticated, service_role;

revoke all on function public.submit_manager_transfer_response(text, uuid, text, text) from public, anon;
grant execute on function public.submit_manager_transfer_response(text, uuid, text, text) to authenticated, service_role;

revoke all on function public.submit_bulk_registration_commands(text, uuid, text, text[], text[], text[], integer, text, integer, text) from public, anon;
grant execute on function public.submit_bulk_registration_commands(text, uuid, text, text[], text[], text[], integer, text, integer, text) to authenticated, service_role;

revoke all on function public.submit_manager_world_command(text, uuid, text, text, jsonb, text, integer, text) from public, anon;
grant execute on function public.submit_manager_world_command(text, uuid, text, text, jsonb, text, integer, text) to authenticated, service_role;

-- Service-role-only RPCs.
revoke all on function public.apply_canonical_registration_repair(text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_canonical_registration_repair(text, text, text, jsonb, jsonb) to service_role;

revoke all on function public.claim_expired_fixtures_for_submission_lock(integer) from public, anon, authenticated;
grant execute on function public.claim_expired_fixtures_for_submission_lock(integer) to service_role;

revoke all on function public.claim_fixtures_for_engine(integer) from public, anon, authenticated;
grant execute on function public.claim_fixtures_for_engine(integer) to service_role;

revoke all on function public.complete_fixture_submission_lock(text, text) from public, anon, authenticated;
grant execute on function public.complete_fixture_submission_lock(text, text) to service_role;

revoke all on function public.finalise_match_and_competition_state(text, integer, integer, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.finalise_match_and_competition_state(text, integer, integer, jsonb, timestamptz) to service_role;

revoke all on function public.finalize_manager_world_command(uuid, text, text, jsonb, text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.finalize_manager_world_command(uuid, text, text, jsonb, text, text, text, timestamptz, text) to service_role;

revoke all on function public.finish_fixture_engine_run(text, text, text) from public, anon, authenticated;
grant execute on function public.finish_fixture_engine_run(text, text, text) to service_role;

revoke all on function public.initialize_canonical_world(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.initialize_canonical_world(jsonb, jsonb, jsonb) to service_role;

revoke all on function public.persist_season_match_report_bundle(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.persist_season_match_report_bundle(text, text, text, jsonb) to service_role;

revoke all on function public.rebuild_competition_standings(text, text, text) from public, anon, authenticated;
grant execute on function public.rebuild_competition_standings(text, text, text) to service_role;

revoke all on function public.recover_stale_canonical_turn_lock(text, text, timestamptz, uuid, timestamptz, interval) from public, anon, authenticated;
grant execute on function public.recover_stale_canonical_turn_lock(text, text, timestamptz, uuid, timestamptz, interval) to service_role;

revoke all on function public.replace_canonical_world_checkpoint(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_canonical_world_checkpoint(text, text, jsonb) to service_role;

-- The live database currently exposes these functions through inherited PUBLIC
-- execute privileges. This is deliberately preserved here for rollback parity.
grant execute on function public.get_manager_portal_world_fragment(text, text) to public, anon, authenticated, service_role;
grant execute on function public.handle_new_auth_user() to public, anon, authenticated, service_role;
grant execute on function public.lock_expired_manager_submissions() to public, anon, authenticated, service_role;
grant execute on function public.propagate_transfer_response_outcome() to public, anon, authenticated, service_role;
grant execute on function public.rls_auto_enable() to public, anon, authenticated, service_role;
grant execute on function public.manager_command_subject_key(text, jsonb) to public, anon, authenticated, service_role;
grant execute on function public.tbg_canonical_jsonb_text(jsonb) to public, anon, authenticated, service_role;

-- Restore the observed function configuration.
alter function public.manager_command_subject_key(text, jsonb) reset all;
alter function public.tbg_canonical_jsonb_text(jsonb) reset all;
alter function public.rls_auto_enable() set search_path = pg_catalog;

commit;
