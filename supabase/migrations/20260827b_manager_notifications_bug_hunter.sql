begin;

create table if not exists public.manager_notifications (
  id uuid primary key default gen_random_uuid(),
  world_id text not null references public.worlds(id) on delete cascade,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  notification_type text not null,
  notification_class text not null default 'info' check (notification_class in ('info','action_required','reward','system')),
  title text not null,
  body text,
  action_url text,
  source_type text,
  source_id text,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(manager_id, dedupe_key)
);
create index if not exists manager_notifications_manager_created_idx on public.manager_notifications(manager_id, created_at desc);
create index if not exists manager_notifications_unread_idx on public.manager_notifications(manager_id, created_at desc) where read_at is null;
alter table public.manager_notifications enable row level security;

create table if not exists public.alpha_feedback_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.alpha_feedback_reports(id) on delete cascade,
  world_id text not null references public.worlds(id) on delete cascade,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  event_type text not null,
  status text,
  severity text,
  github_issue_url text,
  dedupe_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists alpha_feedback_events_report_idx on public.alpha_feedback_events(report_id, created_at);
alter table public.alpha_feedback_events enable row level security;

create table if not exists public.alpha_feedback_bug_credits (
  report_id uuid primary key references public.alpha_feedback_reports(id) on delete cascade,
  world_id text not null references public.worlds(id) on delete cascade,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  severity text not null check (severity in ('low','medium','high','critical')),
  points integer not null check (points in (1,2,4,8)),
  credited_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists alpha_feedback_bug_credits_manager_idx on public.alpha_feedback_bug_credits(manager_id, credited_at);
alter table public.alpha_feedback_bug_credits enable row level security;

create or replace function public.alpha_feedback_points(p_severity text)
returns integer language sql immutable as $$
  select case p_severity when 'critical' then 8 when 'high' then 4 when 'medium' then 2 else 1 end;
$$;

create or replace function public.record_alpha_feedback_event(
  p_report public.alpha_feedback_reports,
  p_event_type text,
  p_title text,
  p_body text,
  p_class text default 'info',
  p_action_url text default null,
  p_created_at timestamptz default now()
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_key text;
begin
  v_key := 'alpha_feedback:' || p_report.id::text || ':' || p_event_type;
  insert into public.alpha_feedback_events(
    report_id, world_id, manager_id, event_type, status, severity, github_issue_url, dedupe_key, created_at
  ) values (
    p_report.id, p_report.world_id, p_report.manager_id, p_event_type, p_report.status, p_report.severity,
    p_report.github_issue_url, v_key, p_created_at
  ) on conflict(dedupe_key) do nothing;

  insert into public.manager_notifications(
    world_id, manager_id, notification_type, notification_class, title, body,
    action_url, source_type, source_id, dedupe_key, created_at
  ) values (
    p_report.world_id, p_report.manager_id, 'alpha_feedback', p_class, p_title, p_body,
    coalesce(p_action_url, p_report.github_issue_url), 'alpha_feedback_report', p_report.id::text,
    v_key, p_created_at
  ) on conflict(manager_id, dedupe_key) do nothing;
end;
$$;

create or replace function public.emit_alpha_feedback_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_points integer;
  v_old_points integer := 0;
begin
  if tg_op = 'INSERT' then
    perform public.record_alpha_feedback_event(
      new, 'submitted', 'Report received',
      'Thanks — your alpha report has been added to the review queue.', 'info', null, new.created_at
    );
  else
    if new.status is distinct from old.status then
      if new.status = 'triaged' then
        perform public.record_alpha_feedback_event(
          new, 'status_triaged', 'Report confirmed',
          case when new.severity is null then 'Your report has been reviewed and confirmed.' else 'Your report has been confirmed as ' || new.severity || ' impact.' end
        );
      elsif new.status = 'fixed' then
        perform public.record_alpha_feedback_event(
          new, 'status_fixed', 'Report fixed',
          'A fix for your report has been completed. Thanks for helping improve The Beautiful Game.', 'reward'
        );
      elsif new.status = 'wont_fix' then
        perform public.record_alpha_feedback_event(
          new, 'status_wont_fix', 'Report closed',
          'Your report has been reviewed and closed without a planned change.'
        );
      else
        perform public.record_alpha_feedback_event(
          new, 'status_' || new.status, 'Report updated', 'The status of your alpha report has changed.'
        );
      end if;
    end if;

    if new.github_issue_url is distinct from old.github_issue_url and new.github_issue_url is not null then
      perform public.record_alpha_feedback_event(
        new, 'promoted_to_github', 'Investigation opened',
        'Your report has been promoted into the engineering queue.', 'info', new.github_issue_url
      );
    end if;

    if new.severity is distinct from old.severity and new.severity is not null then
      perform public.record_alpha_feedback_event(
        new, 'severity_' || new.severity, 'Report impact assessed',
        'Your report has been assessed as ' || new.severity || ' impact.'
      );
    end if;
  end if;

  if new.kind = 'bug' and new.status in ('triaged','fixed') and new.severity is not null then
    v_points := public.alpha_feedback_points(new.severity);
    select points into v_old_points from public.alpha_feedback_bug_credits where report_id = new.id;
    v_old_points := coalesce(v_old_points, 0);

    insert into public.alpha_feedback_bug_credits(report_id, world_id, manager_id, severity, points)
    values (new.id, new.world_id, new.manager_id, new.severity, v_points)
    on conflict(report_id) do update set
      severity = case when excluded.points > public.alpha_feedback_bug_credits.points then excluded.severity else public.alpha_feedback_bug_credits.severity end,
      points = greatest(public.alpha_feedback_bug_credits.points, excluded.points),
      updated_at = now();

    if v_points > v_old_points then
      insert into public.manager_notifications(
        world_id, manager_id, notification_type, notification_class, title, body,
        source_type, source_id, dedupe_key
      ) values (
        new.world_id, new.manager_id, 'bug_hunter_reward', 'reward', 'Bug Hunter credit earned',
        'This confirmed ' || new.severity || '-impact report is worth ' || v_points || ' Bug Hunter point' || case when v_points = 1 then '' else 's' end || '.',
        'alpha_feedback_report', new.id::text,
        'alpha_feedback:' || new.id::text || ':credit:' || v_points::text
      ) on conflict(manager_id, dedupe_key) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists alpha_feedback_lifecycle_notifications on public.alpha_feedback_reports;
create trigger alpha_feedback_lifecycle_notifications
  after insert or update of status, severity, github_issue_url on public.alpha_feedback_reports
  for each row execute function public.emit_alpha_feedback_lifecycle();

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
  where manager_id = v_manager_id and world_id = p_world_id;

  return jsonb_build_object(
    'notifications', v_notifications,
    'unread_count', (select count(*) from public.manager_notifications where manager_id = v_manager_id and world_id = p_world_id and read_at is null),
    'reports', v_reports,
    'bug_hunter', jsonb_build_object('points',v_points,'confirmed_reports',v_confirmed,'max_report_points',v_max_points)
  );
end;
$$;

create or replace function public.mark_manager_notification_read_for_user(
  p_user_id uuid, p_world_id text, p_notification_id uuid default null, p_all boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_manager_id uuid; v_count integer;
begin
  select p.id into v_manager_id
  from public.manager_profiles p
  join public.manager_appointments a on a.manager_id = p.id and a.world_id = p_world_id and a.status = 'active'
  where p.user_id = p_user_id and p.status = 'active' limit 1;
  if v_manager_id is null then raise exception 'No active manager appointment for this user and world'; end if;

  update public.manager_notifications set read_at = coalesce(read_at, now())
  where manager_id = v_manager_id and world_id = p_world_id
    and (p_all or (not p_all and id = p_notification_id));
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',true,'updated',v_count);
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
  from public.alpha_feedback_bug_credits where manager_id=v_target and world_id=p_world_id;

  if v_count >= 1 then v_pins := v_pins || jsonb_build_array(jsonb_build_object('key','bug_spotter','icon','🐞','name','Bug Spotter','description','Reported a confirmed TBG bug.')); end if;
  if v_count >= 5 then v_pins := v_pins || jsonb_build_array(jsonb_build_object('key','bug_hunter','icon','🔎','name','Bug Hunter','description','Reported five confirmed TBG bugs.')); end if;
  if v_count >= 10 then v_pins := v_pins || jsonb_build_array(jsonb_build_object('key','bug_detective','icon','🕵️','name','Bug Detective','description','Reported ten confirmed TBG bugs.')); end if;
  if v_max >= 4 then v_pins := v_pins || jsonb_build_array(jsonb_build_object('key','match_saver','icon','🧯','name','Match Saver','description','Uncovered a high-impact bug.')); end if;
  if v_max >= 8 then v_pins := v_pins || jsonb_build_array(jsonb_build_object('key','game_saver','icon','🚨','name','Game Saver','description','Uncovered a critical game-breaking bug.')); end if;
  if v_count >= 1 then v_pins := v_pins || jsonb_build_array(jsonb_build_object('key','alpha_pioneer','icon','🧪','name','Alpha Pioneer','description','Helped improve TBG during the controlled alpha.')); end if;

  return jsonb_build_object(
    'pins',v_pins,
    'private_detail',case when v_target=v_caller then jsonb_build_object('points',v_points,'confirmed_reports',v_count,'max_report_points',v_max) else null end
  );
end;
$$;

revoke all on function public.get_manager_notifications_for_user(uuid,text) from public, anon, authenticated;
revoke all on function public.mark_manager_notification_read_for_user(uuid,text,uuid,boolean) from public, anon, authenticated;
revoke all on function public.get_manager_bug_hunter_for_user(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.get_manager_notifications_for_user(uuid,text) to service_role;
grant execute on function public.mark_manager_notification_read_for_user(uuid,text,uuid,boolean) to service_role;
grant execute on function public.get_manager_bug_hunter_for_user(uuid,text,uuid) to service_role;

-- Backfill existing alpha reports into the lifecycle timeline and reward ledger.
insert into public.alpha_feedback_events(report_id,world_id,manager_id,event_type,status,severity,github_issue_url,dedupe_key,created_at)
select id,world_id,manager_id,'submitted',status,severity,github_issue_url,
       'alpha_feedback:' || id::text || ':submitted', created_at
from public.alpha_feedback_reports on conflict(dedupe_key) do nothing;

insert into public.alpha_feedback_events(report_id,world_id,manager_id,event_type,status,severity,github_issue_url,dedupe_key,created_at)
select id,world_id,manager_id,'status_' || status,status,severity,github_issue_url,
       'alpha_feedback:' || id::text || ':status_' || status, updated_at
from public.alpha_feedback_reports where status <> 'new' on conflict(dedupe_key) do nothing;

insert into public.alpha_feedback_events(report_id,world_id,manager_id,event_type,status,severity,github_issue_url,dedupe_key,created_at)
select id,world_id,manager_id,'promoted_to_github',status,severity,github_issue_url,
       'alpha_feedback:' || id::text || ':promoted_to_github', updated_at
from public.alpha_feedback_reports where github_issue_url is not null on conflict(dedupe_key) do nothing;

insert into public.alpha_feedback_bug_credits(report_id,world_id,manager_id,severity,points,credited_at)
select id,world_id,manager_id,severity,public.alpha_feedback_points(severity),updated_at
from public.alpha_feedback_reports where kind='bug' and status in ('triaged','fixed') and severity is not null
on conflict(report_id) do nothing;

-- Backfill only meaningful current-state notifications; don't turn every historic event into unread noise.
insert into public.manager_notifications(world_id,manager_id,notification_type,notification_class,title,body,action_url,source_type,source_id,dedupe_key,created_at)
select world_id,manager_id,'alpha_feedback',case when status='fixed' then 'reward' else 'info' end,
       case status when 'triaged' then 'Report confirmed' when 'fixed' then 'Report fixed' when 'wont_fix' then 'Report closed' else 'Report received' end,
       case status when 'triaged' then 'Your report has been reviewed and confirmed.' when 'fixed' then 'A fix for your report has been completed. Thanks for helping improve The Beautiful Game.' when 'wont_fix' then 'Your report has been reviewed and closed without a planned change.' else 'Thanks — your alpha report has been added to the review queue.' end,
       github_issue_url,'alpha_feedback_report',id::text,'alpha_feedback:' || id::text || ':backfill_current',updated_at
from public.alpha_feedback_reports
on conflict(manager_id,dedupe_key) do nothing;

commit;
