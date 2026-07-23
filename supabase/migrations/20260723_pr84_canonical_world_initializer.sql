-- PR #84: admin-only initialization of the first canonical shared world.

-- Replace the operational event constraint so initialization has its own audit identity.
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
      check (operation_type in ('initialize','backup','restore','rollback','reset','monitor'));
  end if;
end $$;

-- Retire the internal setup token from the manager-facing world record.
update public.worlds
set status = 'active', updated_at = now()
where status = 'inaugural_divisions_seeded';
