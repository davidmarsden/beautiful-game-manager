-- Production hardening: keep derived match archive projection out of the
-- canonical checkpoint transaction. The canonical world commit is authoritative;
-- archives are a rebuildable read projection and must not be able to abort it.
--
-- Also reassert the PR #192 recovery status constraint because production drift
-- was exposed when a database restart attempted to persist reconciliation_required.

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'world_turn_runs'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%processing%complete%failed%skipped%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.world_turn_runs drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.world_turn_runs
  add constraint world_turn_runs_status_check
  check (status in ('processing','complete','failed','skipped','reconciliation_required'));

-- The trigger function is intentionally retained for now as a recovery/backfill
-- primitive, but it must not execute inside replace_canonical_world_checkpoint.
drop trigger if exists canonical_world_save_match_archive_refresh
  on public.canonical_world_saves;
