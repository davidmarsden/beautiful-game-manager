begin;

create table if not exists public.alpha_feedback_reports (
  id uuid primary key default gen_random_uuid(),
  world_id text not null references public.worlds(id) on delete cascade,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  club_id text references public.clubs(id) on delete set null,
  kind text not null check (kind in ('bug','feedback')),
  category text not null check (category in ('broken','confusing','presentation','performance','feature_request','other')),
  page_area text,
  action_taken text,
  expected_result text,
  actual_result text,
  note text,
  client_context jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new','triaged','fixed','wont_fix')),
  severity text check (severity is null or severity in ('low','medium','high','critical')),
  admin_note text,
  github_issue_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists alpha_feedback_reports_world_created_idx
  on public.alpha_feedback_reports(world_id, created_at desc);
create index if not exists alpha_feedback_reports_manager_created_idx
  on public.alpha_feedback_reports(manager_id, created_at desc);
create index if not exists alpha_feedback_reports_status_idx
  on public.alpha_feedback_reports(world_id, status, created_at desc);

alter table public.alpha_feedback_reports enable row level security;

create or replace function public.submit_alpha_feedback_for_user(
  p_user_id uuid,
  p_world_id text,
  p_kind text,
  p_category text,
  p_page_area text default null,
  p_action_taken text default null,
  p_expected_result text default null,
  p_actual_result text default null,
  p_note text default null,
  p_client_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_manager public.manager_profiles%rowtype;
  v_club_id text;
  v_id uuid;
begin
  select * into v_manager
  from public.manager_profiles
  where user_id = p_user_id and status = 'active'
  limit 1;

  if v_manager.id is null then
    return jsonb_build_object('ok', false, 'code', 'manager_profile_missing');
  end if;

  if p_kind not in ('bug','feedback') then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind');
  end if;
  if p_category not in ('broken','confusing','presentation','performance','feature_request','other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_category');
  end if;
  if coalesce(length(p_note),0) > 6000
     or coalesce(length(p_action_taken),0) > 4000
     or coalesce(length(p_expected_result),0) > 4000
     or coalesce(length(p_actual_result),0) > 4000
     or coalesce(length(p_page_area),0) > 500 then
    return jsonb_build_object('ok', false, 'code', 'feedback_too_long');
  end if;

  if (
    select count(*) from public.alpha_feedback_reports r
    where r.manager_id = v_manager.id and r.created_at > now() - interval '1 hour'
  ) >= 20 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  select a.club_id into v_club_id
  from public.manager_appointments a
  where a.world_id = p_world_id and a.manager_id = v_manager.id and a.status = 'active'
  limit 1;

  insert into public.alpha_feedback_reports (
    world_id, manager_id, club_id, kind, category, page_area,
    action_taken, expected_result, actual_result, note, client_context
  ) values (
    p_world_id, v_manager.id, v_club_id, p_kind, p_category,
    nullif(trim(p_page_area),''), nullif(trim(p_action_taken),''),
    nullif(trim(p_expected_result),''), nullif(trim(p_actual_result),''),
    nullif(trim(p_note),''), coalesce(p_client_context,'{}'::jsonb)
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'report_id', v_id);
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

  return jsonb_build_object('ok', true, 'reports', v_reports);
end;
$$;

create or replace function public.admin_update_alpha_feedback_report(
  p_admin_user_id uuid,
  p_report_id uuid,
  p_status text,
  p_severity text default null,
  p_admin_note text default null,
  p_github_issue_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.manager_profiles%rowtype;
begin
  select * into v_admin from public.manager_profiles where user_id = p_admin_user_id limit 1;
  if v_admin.id is null or not v_admin.is_admin then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;
  if p_status not in ('new','triaged','fixed','wont_fix') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;
  if p_severity is not null and p_severity not in ('low','medium','high','critical') then
    return jsonb_build_object('ok', false, 'code', 'invalid_severity');
  end if;

  update public.alpha_feedback_reports
  set status = p_status,
      severity = p_severity,
      admin_note = nullif(trim(p_admin_note),''),
      github_issue_url = nullif(trim(p_github_issue_url),''),
      updated_at = now()
  where id = p_report_id;

  if not found then return jsonb_build_object('ok', false, 'code', 'report_not_found'); end if;
  return jsonb_build_object('ok', true, 'report_id', p_report_id);
end;
$$;

revoke all on function public.submit_alpha_feedback_for_user(uuid,text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.get_alpha_feedback_admin_context_for_user(uuid,text) from public, anon, authenticated;
revoke all on function public.admin_update_alpha_feedback_report(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.submit_alpha_feedback_for_user(uuid,text,text,text,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.get_alpha_feedback_admin_context_for_user(uuid,text) to service_role;
grant execute on function public.admin_update_alpha_feedback_report(uuid,uuid,text,text,text,text) to service_role;

commit;
