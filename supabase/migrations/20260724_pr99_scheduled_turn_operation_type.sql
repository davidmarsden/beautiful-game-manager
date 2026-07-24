-- PR #99: permit immutable audit events for canonical scheduled-turn advancement.

-- The administrator acceptance endpoint records an `advance` operation only after
-- the production scheduler has replaced the canonical checkpoint. Keep the
-- operation type constrained, but include that explicit production action.
do $$
declare
  constraint_name text;
begin
  if to_regclass('public.world_operation_events') is not null then
    select conname into constraint_name
    from pg_constraint
    where conrelid = 'public.world_operation_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%operation_type%';

    if constraint_name is not null then
      execute format('alter table public.world_operation_events drop constraint %I', constraint_name);
    end if;

    alter table public.world_operation_events
      add constraint world_operation_events_operation_type_check
      check (operation_type in ('initialize','backup','restore','rollback','reset','monitor','advance'));
  end if;
end $$;
