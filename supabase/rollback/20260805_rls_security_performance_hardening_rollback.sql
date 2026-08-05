-- Restore direct auth.uid() evaluation and the separate alert SELECT policy.

begin;

do $rollback_policies$
declare
  policy_row record;
  alter_sql text;
  using_expression text;
  check_expression text;
begin
  for policy_row in
    select schemaname, tablename, policyname, qual, with_check
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') like '%( SELECT auth.uid() AS uid)%'
        or coalesce(with_check, '') like '%( SELECT auth.uid() AS uid)%'
      )
  loop
    using_expression := replace(policy_row.qual, '( SELECT auth.uid() AS uid)', 'auth.uid()');
    check_expression := replace(policy_row.with_check, '( SELECT auth.uid() AS uid)', 'auth.uid()');

    alter_sql := format(
      'alter policy %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );

    if using_expression is not null then
      alter_sql := alter_sql || format(' using (%s)', using_expression);
    end if;

    if check_expression is not null then
      alter_sql := alter_sql || format(' with check (%s)', check_expression);
    end if;

    execute alter_sql;
  end loop;
end
$rollback_policies$;

create policy "admins read operation alerts"
  on public.world_operation_alerts
  for select
  using (
    exists (
      select 1
      from public.manager_profiles p
      where p.user_id = auth.uid()
        and p.is_admin = true
    )
  );

comment on table public.manager_canonical_match_views is null;

commit;
