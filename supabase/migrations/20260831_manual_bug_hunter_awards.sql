begin;

create or replace function public.admin_award_external_bug_credit(
  p_admin_user_id uuid,
  p_world_id text,
  p_manager_id uuid,
  p_severity text,
  p_reason text,
  p_source_channel text default 'other'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.manager_profiles%rowtype;
  v_club_id text;
  v_report_id uuid;
  v_reason text := nullif(trim(p_reason), '');
  v_channel text := lower(coalesce(nullif(trim(p_source_channel), ''), 'other'));
begin
  select * into v_admin
  from public.manager_profiles
  where user_id = p_admin_user_id
  limit 1;

  if v_admin.id is null or not v_admin.is_admin then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;

  if p_severity not in ('low','medium','high','critical') then
    return jsonb_build_object('ok', false, 'code', 'invalid_severity');
  end if;

  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if length(v_reason) > 2000 then
    return jsonb_build_object('ok', false, 'code', 'reason_too_long');
  end if;

  if v_channel not in ('whatsapp','email','conversation','discord','other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_source_channel');
  end if;

  select a.club_id into v_club_id
  from public.manager_appointments a
  where a.world_id = p_world_id
    and a.manager_id = p_manager_id
    and a.status = 'active'
  limit 1;

  if v_club_id is null then
    return jsonb_build_object('ok', false, 'code', 'manager_not_active_in_world');
  end if;

  insert into public.alpha_feedback_reports (
    world_id,
    manager_id,
    club_id,
    kind,
    category,
    page_area,
    note,
    client_context,
    status,
    severity,
    admin_note
  ) values (
    p_world_id,
    p_manager_id,
    v_club_id,
    'bug',
    'other',
    'External tester report',
    v_reason,
    jsonb_build_object(
      'source', 'external_admin_award',
      'channel', v_channel,
      'awarded_by_manager_id', v_admin.id
    ),
    'triaged',
    p_severity,
    'Bug Hunter credit awarded for a confirmed report received outside the in-game feedback form.'
  ) returning id into v_report_id;

  return jsonb_build_object(
    'ok', true,
    'report_id', v_report_id,
    'manager_id', p_manager_id,
    'severity', p_severity,
    'points', public.alpha_feedback_points(p_severity),
    'source_channel', v_channel
  );
end;
$$;

create or replace function public.get_alpha_feedback_admin_context_for_user(
  p_user_id uuid,
  p_world_id text default 'tbg-world-1'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.manager_profiles%rowtype;
  v_reports jsonb;
  v_managers jsonb;
begin
  select * into v_admin from public.manager_profiles where user_id = p_user_id limit 1;
  if v_admin.id is null or not v_admin.is_admin then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_reports
  from (
    select r.id, r.kind, r.category, r.page_area, r.action_taken,
           r.expected_result, r.actual_result, r.note, r.client_context,
           r.status, r.severity, r.admin_note, r.github_issue_url,
           r.created_at, r.updated_at,
           m.display_name as manager_name, m.email as manager_email,
           c.name as club_name
    from public.alpha_feedback_reports r
    join public.manager_profiles m on m.id = r.manager_id
    left join public.clubs c on c.id = r.club_id
    where r.world_id = p_world_id
    order by r.created_at desc
    limit 100
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.manager_name), '[]'::jsonb)
  into v_managers
  from (
    select m.id as manager_id,
           m.display_name as manager_name,
           a.club_id,
           c.name as club_name
    from public.manager_appointments a
    join public.manager_profiles m on m.id = a.manager_id
    left join public.clubs c on c.id = a.club_id
    where a.world_id = p_world_id
      and a.status = 'active'
      and m.status = 'active'
    order by m.display_name
  ) x;

  return jsonb_build_object('ok', true, 'reports', v_reports, 'managers', v_managers);
end;
$$;

revoke all on function public.admin_award_external_bug_credit(uuid,text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.admin_award_external_bug_credit(uuid,text,uuid,text,text,text) to service_role;

commit;
