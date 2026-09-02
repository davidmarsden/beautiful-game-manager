begin;

alter table public.alpha_feedback_bug_credits
  add column if not exists contribution_type text not null default 'bug';

alter table public.alpha_feedback_bug_credits
  alter column severity drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'alpha_feedback_bug_credits_contribution_type_check'
      and conrelid = 'public.alpha_feedback_bug_credits'::regclass
  ) then
    alter table public.alpha_feedback_bug_credits
      add constraint alpha_feedback_bug_credits_contribution_type_check
      check (contribution_type in ('bug','feature','ux','data','other'));
  end if;
end $$;

alter table public.alpha_feedback_bug_credits
  drop constraint if exists alpha_feedback_bug_credits_points_check;
alter table public.alpha_feedback_bug_credits
  add constraint alpha_feedback_bug_credits_points_check
  check (points in (1,2,3,4,8));

create index if not exists alpha_feedback_tester_credits_manager_idx
  on public.alpha_feedback_bug_credits(manager_id, contribution_type, credited_at);

create or replace function public.admin_award_external_tester_credit(
  p_admin_user_id uuid,
  p_world_id text,
  p_manager_id uuid,
  p_contribution_type text,
  p_reason text,
  p_source_channel text default 'other',
  p_points integer default 1,
  p_severity text default null
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
  v_type text := lower(coalesce(nullif(trim(p_contribution_type), ''), 'other'));
  v_points integer;
  v_severity text := lower(nullif(trim(p_severity), ''));
  v_kind text;
  v_category text;
  v_label text;
begin
  select * into v_admin
  from public.manager_profiles
  where user_id = p_admin_user_id
  limit 1;

  if v_admin.id is null or not v_admin.is_admin then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;

  if v_type not in ('bug','feature','ux','data','other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_contribution_type');
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

  if v_type = 'bug' then
    if v_severity not in ('low','medium','high','critical') then
      return jsonb_build_object('ok', false, 'code', 'invalid_severity');
    end if;
    v_points := public.alpha_feedback_points(v_severity);
    v_kind := 'bug';
    v_category := 'other';
    v_label := 'Bug report';
  else
    if p_points not in (1,2,3) then
      return jsonb_build_object('ok', false, 'code', 'invalid_contribution_points');
    end if;
    v_points := p_points;
    v_severity := null;
    v_kind := 'feedback';
    v_category := case v_type
      when 'feature' then 'feature_request'
      when 'ux' then 'confusing'
      else 'other'
    end;
    v_label := case v_type
      when 'feature' then 'Feature suggestion'
      when 'ux' then 'UX improvement'
      when 'data' then 'Data issue'
      else 'Tester contribution'
    end;
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
    v_kind,
    v_category,
    'External tester contribution',
    v_reason,
    jsonb_build_object(
      'source', 'external_admin_award',
      'channel', v_channel,
      'contribution_type', v_type,
      'points', v_points,
      'awarded_by_manager_id', v_admin.id
    ),
    'triaged',
    v_severity,
    'Tester contribution credit awarded for useful feedback received outside the in-game feedback form.'
  ) returning id into v_report_id;

  insert into public.alpha_feedback_bug_credits(
    report_id, world_id, manager_id, severity, points, contribution_type
  ) values (
    v_report_id, p_world_id, p_manager_id, v_severity, v_points, v_type
  )
  on conflict(report_id) do update set
    severity = excluded.severity,
    points = greatest(public.alpha_feedback_bug_credits.points, excluded.points),
    contribution_type = excluded.contribution_type,
    updated_at = now();

  if v_type <> 'bug' then
    insert into public.manager_notifications(
      world_id, manager_id, notification_type, notification_class, title, body,
      source_type, source_id, dedupe_key
    ) values (
      p_world_id, p_manager_id, 'tester_contribution_reward', 'reward', 'Tester contribution credit earned',
      v_label || ' · ' || v_points || ' point' || case when v_points = 1 then '' else 's' end || '. Thanks for helping improve The Beautiful Game.',
      'alpha_feedback_report', v_report_id::text,
      'alpha_feedback:' || v_report_id::text || ':tester_credit:' || v_points::text
    ) on conflict(manager_id, dedupe_key) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'report_id', v_report_id,
    'manager_id', p_manager_id,
    'contribution_type', v_type,
    'severity', v_severity,
    'points', v_points,
    'source_channel', v_channel
  );
end;
$$;

-- Keep the original RPC as a compatibility wrapper for any older admin client.
create or replace function public.admin_award_external_bug_credit(
  p_admin_user_id uuid,
  p_world_id text,
  p_manager_id uuid,
  p_severity text,
  p_reason text,
  p_source_channel text default 'other'
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.admin_award_external_tester_credit(
    p_admin_user_id,
    p_world_id,
    p_manager_id,
    'bug',
    p_reason,
    p_source_channel,
    1,
    p_severity
  );
$$;

create or replace function public.get_manager_notifications_for_user(p_user_id uuid, p_world_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_manager_id uuid;
  v_notifications jsonb;
  v_reports jsonb;
  v_points integer := 0;
  v_confirmed integer := 0;
  v_max_points integer := 0;
  v_contribution_points integer := 0;
  v_contribution_count integer := 0;
begin
  select p.id into v_manager_id
  from public.manager_profiles p
  join public.manager_appointments a on a.manager_id = p.id and a.world_id = p_world_id and a.status = 'active'
  where p.user_id = p_user_id and p.status = 'active'
  limit 1;
  if v_manager_id is null then raise exception 'No active manager appointment for this user and world'; end if;

  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb) into v_notifications
  from (
    select id, notification_type, notification_class, title, body, action_url, source_type, source_id, read_at, created_at
    from public.manager_notifications
    where manager_id = v_manager_id and world_id = p_world_id
    order by created_at desc limit 100
  ) n;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v_reports
  from (
    select id, kind, category, page_area, status, severity, github_issue_url, created_at, updated_at,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'event_type',e.event_type,'status',e.status,'severity',e.severity,
        'github_issue_url',e.github_issue_url,'created_at',e.created_at
      ) order by e.created_at),'[]'::jsonb) from public.alpha_feedback_events e where e.report_id = report.id) as events
    from public.alpha_feedback_reports report
    where report.manager_id = v_manager_id and report.world_id = p_world_id
    order by report.created_at desc limit 50
  ) r;

  select coalesce(sum(points),0)::integer, count(*)::integer, coalesce(max(points),0)::integer
    into v_points, v_confirmed, v_max_points
  from public.alpha_feedback_bug_credits
  where manager_id = v_manager_id and world_id = p_world_id and contribution_type = 'bug';

  select coalesce(sum(points),0)::integer, count(*)::integer
    into v_contribution_points, v_contribution_count
  from public.alpha_feedback_bug_credits
  where manager_id = v_manager_id and world_id = p_world_id;

  return jsonb_build_object(
    'notifications', v_notifications,
    'unread_count', (select count(*) from public.manager_notifications where manager_id = v_manager_id and world_id = p_world_id and read_at is null),
    'reports', v_reports,
    'bug_hunter', jsonb_build_object('points',v_points,'confirmed_reports',v_confirmed,'max_report_points',v_max_points),
    'tester_contributions', jsonb_build_object('points',v_contribution_points,'credited_contributions',v_contribution_count)
  );
end;
$$;

create or replace function public.get_manager_bug_hunter_for_user(
  p_user_id uuid, p_world_id text, p_target_manager_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid;
  v_target uuid;
  v_points integer := 0;
  v_count integer := 0;
  v_max integer := 0;
  v_all_count integer := 0;
  v_pins jsonb := '[]'::jsonb;
begin
  select p.id into v_caller from public.manager_profiles p
  join public.manager_appointments a on a.manager_id=p.id and a.world_id=p_world_id and a.status='active'
  where p.user_id=p_user_id and p.status='active' limit 1;
  if v_caller is null then raise exception 'No active manager appointment for this user and world'; end if;
  v_target := coalesce(p_target_manager_id, v_caller);
  if not exists(select 1 from public.manager_appointments where world_id=p_world_id and manager_id=v_target and status='active') then
    raise exception 'Manager is not active in this world';
  end if;

  select coalesce(sum(points),0)::integer, count(*)::integer, coalesce(max(points),0)::integer
    into v_points,v_count,v_max
  from public.alpha_feedback_bug_credits
  where manager_id=v_target and world_id=p_world_id and contribution_type='bug';

  select count(*)::integer into v_all_count
  from public.alpha_feedback_bug_credits
  where manager_id=v_target and world_id=p_world_id;

  if v_count >= 1 then v_pins := v_pins || jsonb_build_array(jsonb_build_object('key','bug_spotter','icon','🐞','name','Bug Spotter','description','Reported a confirmed TBG bug.')); end if;
  if v_count >= 5 then v_pins := v_pins || jsonb_build_array(jsonb_build_object('key','bug_hunter','icon','🔎','name','Bug Hunter','description','Reported five confirmed TBG bugs.')); end if;
  if v_count >= 10 then v_pins := v_pins || jsonb_build_array(jsonb_build_object('key','bug_detective','icon','🕵️','name','Bug Detective','description','Reported ten confirmed TBG bugs.')); end if;
  if v_max >= 4 then v_pins := v_pins || jsonb_build_array(jsonb_build_object('key','match_saver','icon','🧯','name','Match Saver','description','Uncovered a high-impact bug.')); end if;
  if v_max >= 8 then v_pins := v_pins || jsonb_build_array(jsonb_build_object('key','game_saver','icon','🚨','name','Game Saver','description','Uncovered a critical game-breaking bug.')); end if;
  if v_all_count >= 1 then v_pins := v_pins || jsonb_build_array(jsonb_build_object('key','alpha_pioneer','icon','🧪','name','Alpha Pioneer','description','Helped improve TBG during the controlled alpha.')); end if;

  return jsonb_build_object(
    'pins',v_pins,
    'private_detail',case when v_target=v_caller then jsonb_build_object('points',v_points,'confirmed_reports',v_count,'max_report_points',v_max) else null end
  );
end;
$$;

revoke all on function public.admin_award_external_tester_credit(uuid,text,uuid,text,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.admin_award_external_tester_credit(uuid,text,uuid,text,text,text,integer,text) to service_role;
revoke all on function public.admin_award_external_bug_credit(uuid,text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.admin_award_external_bug_credit(uuid,text,uuid,text,text,text) to service_role;

commit;
