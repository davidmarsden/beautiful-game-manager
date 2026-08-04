-- PR #192: ambiguous checkpoint writes require an explicit recovery-review state.

do $$
declare
  constraint_name text;
begin
  select con.conname
    into constraint_name
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
