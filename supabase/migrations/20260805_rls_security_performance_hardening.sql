-- Harden and optimize authenticated RLS policy evaluation without changing
-- authorization semantics.
--
-- Wrapping auth.uid() in SELECT lets PostgreSQL evaluate the request identity
-- once per statement instead of once per candidate row. The policy predicates
-- otherwise remain identical.

begin;

alter policy "managers can read own profile"
  on public.manager_profiles
  using (user_id = (select auth.uid()));

alter policy "managers can update own profile"
  on public.manager_profiles
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "managers can read their own match views"
  on public.manager_match_views
  using (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
  );

alter policy "managers can create their own match views"
  on public.manager_match_views
  with check (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
  );

alter policy "managers can update their own match views"
  on public.manager_match_views
  using (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
  )
  with check (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
  );

alter policy "authenticated managers can read match events"
  on public.match_events
  using (
    exists (
      select 1
      from public.fixtures f
      join public.manager_appointments ma
        on ma.world_id = f.world_id
       and (ma.club_id = f.home_club_id or ma.club_id = f.away_club_id)
       and ma.status = 'active'
      where f.id = match_events.fixture_id
        and ma.manager_id = (select auth.uid())
    )
  );

alter policy "team_sheet_presets_select_own"
  on public.team_sheet_presets
  using (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
  );

alter policy "team_sheet_presets_insert_own"
  on public.team_sheet_presets
  with check (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.manager_appointments ma
      where ma.manager_id = team_sheet_presets.manager_id
        and ma.club_id = team_sheet_presets.club_id
        and ma.status = 'active'
    )
  );

alter policy "team_sheet_presets_update_own"
  on public.team_sheet_presets
  using (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
  )
  with check (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.manager_appointments ma
      where ma.manager_id = team_sheet_presets.manager_id
        and ma.club_id = team_sheet_presets.club_id
        and ma.status = 'active'
    )
  );

alter policy "team_sheet_presets_delete_own"
  on public.team_sheet_presets
  using (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
  );

alter policy "Managers can read their turn submissions"
  on public.manager_turn_submissions
  using (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
  );

alter policy "Managers can create their appointed turn submissions"
  on public.manager_turn_submissions
  with check (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.manager_appointments a
      where a.manager_id = manager_turn_submissions.manager_id
        and a.world_id = manager_turn_submissions.world_id
        and a.club_id = manager_turn_submissions.club_id
        and a.status = 'active'
    )
  );

alter policy "Managers can update their appointed unlocked turn submissions"
  on public.manager_turn_submissions
  using (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
    and status = any (array['draft'::text, 'submitted'::text])
    and exists (
      select 1
      from public.manager_appointments a
      where a.manager_id = manager_turn_submissions.manager_id
        and a.world_id = manager_turn_submissions.world_id
        and a.club_id = manager_turn_submissions.club_id
        and a.status = 'active'
    )
  )
  with check (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
    and status = any (array['draft'::text, 'submitted'::text])
    and exists (
      select 1
      from public.manager_appointments a
      where a.manager_id = manager_turn_submissions.manager_id
        and a.world_id = manager_turn_submissions.world_id
        and a.club_id = manager_turn_submissions.club_id
        and a.status = 'active'
    )
  );

alter policy "Managers can read their world commands"
  on public.manager_world_commands
  using (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
  );

alter policy "Managers can submit appointed world commands"
  on public.manager_world_commands
  with check (
    manager_id in (
      select manager_profiles.id
      from public.manager_profiles
      where manager_profiles.user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.manager_appointments a
      where a.manager_id = manager_world_commands.manager_id
        and a.world_id = manager_world_commands.world_id
        and a.club_id = manager_world_commands.club_id
        and a.status = 'active'
    )
  );

alter policy "admins read world backups"
  on public.persistent_world_backups
  using (
    exists (
      select 1
      from public.manager_profiles p
      where p.user_id = (select auth.uid())
        and p.is_admin = true
    )
  );

alter policy "admins create world backups"
  on public.persistent_world_backups
  with check (
    exists (
      select 1
      from public.manager_profiles p
      where p.user_id = (select auth.uid())
        and p.is_admin = true
    )
  );

alter policy "admins update world backups"
  on public.persistent_world_backups
  using (
    exists (
      select 1
      from public.manager_profiles p
      where p.user_id = (select auth.uid())
        and p.is_admin = true
    )
  );

alter policy "admins read operation events"
  on public.world_operation_events
  using (
    exists (
      select 1
      from public.manager_profiles p
      where p.user_id = (select auth.uid())
        and p.is_admin = true
    )
  );

alter policy "admins create operation events"
  on public.world_operation_events
  with check (
    exists (
      select 1
      from public.manager_profiles p
      where p.user_id = (select auth.uid())
        and p.is_admin = true
    )
  );

alter policy "admins manage operation alerts"
  on public.world_operation_alerts
  using (
    exists (
      select 1
      from public.manager_profiles p
      where p.user_id = (select auth.uid())
        and p.is_admin = true
    )
  )
  with check (
    exists (
      select 1
      from public.manager_profiles p
      where p.user_id = (select auth.uid())
        and p.is_admin = true
    )
  );

-- The ALL policy already includes SELECT with the same predicate. Keeping the
-- separate SELECT policy makes PostgreSQL evaluate two permissive policies.
drop policy "admins read operation alerts" on public.world_operation_alerts;

alter policy "appointed managers can read world season reports"
  on public.season_match_report_bundles
  using (
    exists (
      select 1
      from public.manager_profiles mp
      join public.manager_appointments ma on ma.manager_id = mp.id
      where mp.user_id = (select auth.uid())
        and ma.status = 'active'
        and ma.world_id = season_match_report_bundles.world_id
    )
  );

alter policy "appointed managers can read canonical match archives"
  on public.canonical_match_archives
  using (
    exists (
      select 1
      from public.manager_profiles mp
      join public.manager_appointments ma on ma.manager_id = mp.id
      where mp.user_id = (select auth.uid())
        and ma.status = 'active'
        and ma.world_id = canonical_match_archives.world_id
    )
  );

-- Fail closed if an unwrapped auth.uid() remains in a public policy, if the
-- duplicate alert policy returns, or if the intentionally server-only canonical
-- projection gains browser SELECT privileges.
do $security_assertions$
declare
  direct_auth_policy_count integer;
begin
  select count(*)
  into direct_auth_policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and (
      coalesce(qual, '') ~ '(^|[^[:alpha:]_])auth\\.uid\\(\\)'
      or coalesce(with_check, '') ~ '(^|[^[:alpha:]_])auth\\.uid\\(\\)'
    )
    and coalesce(qual, '') not like '%SELECT auth.uid()%'
    and coalesce(with_check, '') not like '%SELECT auth.uid()%';

  if direct_auth_policy_count <> 0 then
    raise exception '% public RLS policies still evaluate auth.uid() directly', direct_auth_policy_count;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'world_operation_alerts'
      and policyname = 'admins read operation alerts'
  ) then
    raise exception 'duplicate world_operation_alerts SELECT policy still exists';
  end if;

  if has_table_privilege('anon', 'public.manager_canonical_match_views', 'select')
     or has_table_privilege('authenticated', 'public.manager_canonical_match_views', 'select') then
    raise exception 'manager_canonical_match_views is no longer server-only';
  end if;
end
$security_assertions$;

comment on table public.manager_canonical_match_views is
  'Server-only canonical match projection. RLS intentionally has no browser policy; only trusted service-role workflows may read it.';

commit;
