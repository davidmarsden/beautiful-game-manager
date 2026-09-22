begin;

create table if not exists public.manager_participation_states (
  appointment_id uuid primary key references public.manager_appointments(id) on delete cascade,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  world_id text not null references public.worlds(id) on delete cascade,
  activity_anchor timestamptz not null,
  status text not null check (status in ('caretaker','removed')),
  entered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists manager_participation_states_world_status_idx
  on public.manager_participation_states(world_id, status);

alter table public.manager_participation_states enable row level security;
revoke all on table public.manager_participation_states from public, anon, authenticated;
grant select, insert, update, delete on table public.manager_participation_states to service_role;

create table if not exists public.manager_inactivity_escalations (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  world_id text not null references public.worlds(id) on delete cascade,
  appointment_id uuid not null references public.manager_appointments(id) on delete cascade,
  activity_anchor timestamptz not null,
  stage text not null check (stage in ('caretaker','removal')),
  display_name text,
  email text,
  club_name text,
  status text not null default 'sending' check (status in ('sending','sent','failed')),
  claim_token uuid,
  claimed_at timestamptz,
  applied_at timestamptz,
  sent_at timestamptz,
  resend_message_id text,
  last_error text,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, activity_anchor, stage)
);

create index if not exists manager_inactivity_escalations_due_idx
  on public.manager_inactivity_escalations(status, claimed_at, attempts);

alter table public.manager_inactivity_escalations enable row level security;
revoke all on table public.manager_inactivity_escalations from public, anon, authenticated;
grant select, insert, update, delete on table public.manager_inactivity_escalations to service_role;

create or replace function public.touch_manager_world_activity_atomic(
  p_manager_id uuid,
  p_world_id text,
  p_active_at timestamptz default now()
) returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $
declare
  v_active_at timestamptz := coalesce(p_active_at, now());
begin
  if p_manager_id is null or p_world_id is null then
    raise exception 'Manager and world are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_manager_id::text || ':' || p_world_id, 613));

  insert into public.manager_world_activity(manager_id, world_id, last_active_at)
  values (p_manager_id, p_world_id, v_active_at)
  on conflict (manager_id, world_id) do update
  set last_active_at = greatest(public.manager_world_activity.last_active_at, excluded.last_active_at);

  delete from public.manager_participation_states
  where manager_id = p_manager_id
    and world_id = p_world_id
    and status = 'caretaker';

  return v_active_at;
end;
$;

create or replace function public.claim_manager_inactivity_escalations(
  p_claim_token uuid,
  p_limit integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  result_value jsonb;
  claim_limit integer := greatest(1, least(coalesce(p_limit, 100), 250));
begin
  if p_claim_token is null then raise exception 'Claim token is required'; end if;

  -- Serialize enforcement against portal activity touches. Whichever transaction
  -- acquires this lock first wins; the following statement then sees a fresh
  -- READ COMMITTED snapshot after all earlier touches have committed.
  perform pg_advisory_xact_lock(hashtextextended(appointment.manager_id::text || ':' || appointment.world_id, 613))
  from public.manager_appointments appointment
  join public.manager_profiles profile on profile.id = appointment.manager_id
  left join public.manager_world_activity activity
    on activity.manager_id = appointment.manager_id
   and activity.world_id = appointment.world_id
  left join auth.users auth_user on auth_user.id = profile.user_id
  where appointment.status = 'active'
    and appointment.control_type = 'human'
    and profile.status = 'active'
    and greatest(
      coalesce(activity.last_active_at, auth_user.last_sign_in_at, appointment.appointed_at),
      appointment.appointed_at
    ) <= now() - interval '7 days';

  with active_due as (
    select
      appointment.id as appointment_id,
      appointment.manager_id,
      appointment.world_id,
      club.name as club_name,
      profile.display_name,
      auth_user.email,
      greatest(
        coalesce(activity.last_active_at, auth_user.last_sign_in_at, appointment.appointed_at),
        appointment.appointed_at
      ) as activity_anchor
    from public.manager_appointments appointment
    join public.manager_profiles profile on profile.id = appointment.manager_id
    join public.clubs club on club.id = appointment.club_id
    left join public.manager_world_activity activity
      on activity.manager_id = appointment.manager_id
     and activity.world_id = appointment.world_id
    left join auth.users auth_user on auth_user.id = profile.user_id
    where appointment.status = 'active'
      and appointment.control_type = 'human'
      and profile.status = 'active'
      and auth_user.email is not null
      and greatest(
        coalesce(activity.last_active_at, auth_user.last_sign_in_at, appointment.appointed_at),
        appointment.appointed_at
      ) <= now() - interval '7 days'
      and exists (
        select 1
        from public.manager_inactivity_checkins warning
        where warning.appointment_id = appointment.id
          and warning.activity_anchor = greatest(
            coalesce(activity.last_active_at, auth_user.last_sign_in_at, appointment.appointed_at),
            appointment.appointed_at
          )
          and warning.status = 'sent'
      )
  ), eligible as (
    select
      active_due.*,
      case
        when active_due.activity_anchor <= now() - interval '10 days' then 'removal'::text
        else 'caretaker'::text
      end as stage
    from active_due
  ), new_due as (
    select eligible.*
    from eligible
    where not exists (
      select 1
      from public.manager_inactivity_escalations existing
      where existing.appointment_id = eligible.appointment_id
        and existing.activity_anchor = eligible.activity_anchor
        and existing.stage = eligible.stage
    )
    order by eligible.activity_anchor, eligible.appointment_id
    limit claim_limit
  ), inserted as (
    insert into public.manager_inactivity_escalations(
      manager_id, world_id, appointment_id, activity_anchor, stage,
      display_name, email, club_name,
      status, claim_token, claimed_at, attempts, created_at, updated_at
    )
    select
      new_due.manager_id, new_due.world_id, new_due.appointment_id, new_due.activity_anchor, new_due.stage,
      new_due.display_name, new_due.email, new_due.club_name,
      'sending', p_claim_token, now(), 1, now(), now()
    from new_due
    on conflict (appointment_id, activity_anchor, stage) do nothing
    returning *
  ), retry_active as (
    select existing.id
    from public.manager_inactivity_escalations existing
    join eligible
      on eligible.appointment_id = existing.appointment_id
     and eligible.activity_anchor = existing.activity_anchor
     and eligible.stage = existing.stage
    where existing.stage = 'caretaker'
      and existing.status in ('failed','sending')
      and existing.attempts < 3
      and coalesce(existing.claimed_at, '-infinity'::timestamptz) < now() - interval '15 minutes'
    order by existing.created_at
    limit greatest(0, claim_limit - (select count(*) from inserted))
    for update of existing skip locked
  ), retry_removal as (
    select existing.id
    from public.manager_inactivity_escalations existing
    where existing.stage = 'removal'
      and existing.applied_at is not null
      and existing.status in ('failed','sending')
      and existing.attempts < 3
      and coalesce(existing.claimed_at, '-infinity'::timestamptz) < now() - interval '15 minutes'
    order by existing.created_at
    limit greatest(
      0,
      claim_limit - (select count(*) from inserted) - (select count(*) from retry_active)
    )
    for update of existing skip locked
  ), retried as (
    update public.manager_inactivity_escalations escalation
    set status = 'sending',
        claim_token = p_claim_token,
        claimed_at = now(),
        attempts = escalation.attempts + 1,
        updated_at = now()
    where escalation.id in (
      select id from retry_active
      union all
      select id from retry_removal
    )
    returning escalation.*
  ), claimed as (
    select * from inserted
    union all
    select * from retried
  ), caretaker_state as (
    insert into public.manager_participation_states(
      appointment_id, manager_id, world_id, activity_anchor, status, entered_at, updated_at
    )
    select
      claimed.appointment_id, claimed.manager_id, claimed.world_id, claimed.activity_anchor,
      'caretaker', now(), now()
    from claimed
    where claimed.stage = 'caretaker'
      and claimed.applied_at is null
    on conflict (appointment_id) do update
    set manager_id = excluded.manager_id,
        world_id = excluded.world_id,
        activity_anchor = excluded.activity_anchor,
        status = 'caretaker',
        entered_at = case
          when public.manager_participation_states.activity_anchor is distinct from excluded.activity_anchor
            or public.manager_participation_states.status <> 'caretaker'
          then now()
          else public.manager_participation_states.entered_at
        end,
        updated_at = now()
    returning appointment_id
  ), ended as (
    update public.manager_appointments appointment
    set status = 'ended',
        ended_at = now()
    from claimed
    where claimed.stage = 'removal'
      and claimed.applied_at is null
      and appointment.id = claimed.appointment_id
      and appointment.status = 'active'
      and appointment.control_type = 'human'
    returning
      appointment.id as appointment_id,
      appointment.manager_id,
      appointment.world_id,
      appointment.club_id
  ), pooled as (
    update public.alpha_tester_invites invite
    set status = 'pool',
        claimed_manager_id = null,
        claimed_club_id = null,
        claimed_at = null,
        updated_at = now()
    from ended
    where invite.world_id = ended.world_id
      and invite.claimed_manager_id = ended.manager_id
      and invite.status = 'claimed'
    returning invite.id
  ), removed_state as (
    insert into public.manager_participation_states(
      appointment_id, manager_id, world_id, activity_anchor, status, entered_at, updated_at
    )
    select
      claimed.appointment_id, claimed.manager_id, claimed.world_id, claimed.activity_anchor,
      'removed', now(), now()
    from claimed
    join ended on ended.appointment_id = claimed.appointment_id
    where claimed.stage = 'removal'
    on conflict (appointment_id) do update
    set activity_anchor = excluded.activity_anchor,
        status = 'removed',
        entered_at = now(),
        updated_at = now()
    returning appointment_id
  ), events as (
    insert into public.alpha_appointment_events(
      world_id, manager_id, appointment_id, event_type, from_club_id, actor_manager_id, detail
    )
    select
      ended.world_id,
      ended.manager_id,
      ended.appointment_id,
      'ended',
      ended.club_id,
      null,
      jsonb_build_object(
        'reason', 'Controlled-alpha inactivity after published 3/7/10 participation thresholds.',
        'source', 'manager_inactivity_enforcement',
        'activity_anchor', claimed.activity_anchor,
        'removal_threshold_days', 10
      )
    from ended
    join claimed on claimed.appointment_id = ended.appointment_id and claimed.stage = 'removal'
    where not exists (
      select 1
      from public.alpha_appointment_events existing_event
      where existing_event.appointment_id = ended.appointment_id
        and existing_event.event_type = 'ended'
        and existing_event.detail->>'source' = 'manager_inactivity_enforcement'
        and existing_event.detail->>'activity_anchor' = claimed.activity_anchor::text
    )
    returning appointment_id
  ), notifications as (
    insert into public.manager_notifications(
      world_id, manager_id, notification_type, notification_class,
      title, body, action_url, source_type, source_id, dedupe_key
    )
    select
      claimed.world_id,
      claimed.manager_id,
      case when claimed.stage = 'caretaker' then 'participation_caretaker' else 'participation_removal' end,
      'action_required',
      case
        when claimed.stage = 'caretaker' then 'Your club is in caretaker status'
        else 'Your club appointment has ended'
      end,
      case
        when claimed.stage = 'caretaker'
          then 'You have been inactive for 7 days. Log back in before 10 days of inactivity to recover normal control and keep your appointment.'
        else 'You reached 10 days of inactivity after the participation warning. Your appointment has ended and the club is available for replacement.'
      end,
      '/',
      'manager_participation',
      claimed.appointment_id::text,
      'manager_inactivity_escalation:' || claimed.appointment_id::text || ':' ||
        extract(epoch from claimed.activity_anchor)::bigint::text || ':' || claimed.stage
    from claimed
    where claimed.applied_at is null
      and not exists (
        select 1
        from public.manager_notifications existing_notification
        where existing_notification.dedupe_key =
          'manager_inactivity_escalation:' || claimed.appointment_id::text || ':' ||
          extract(epoch from claimed.activity_anchor)::bigint::text || ':' || claimed.stage
      )
    returning id, manager_id
  ), suppress_generic_email as (
    insert into public.manager_notification_email_deliveries(
      notification_id, manager_id, status, attempts, created_at, updated_at
    )
    select notifications.id, notifications.manager_id, 'skipped', 0, now(), now()
    from notifications
    on conflict (notification_id) do nothing
    returning notification_id
  ), marked_applied as (
    update public.manager_inactivity_escalations escalation
    set applied_at = coalesce(escalation.applied_at, now()),
        updated_at = now()
    from claimed
    where escalation.id = claimed.id
    returning escalation.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'escalation_id', escalation.id,
    'manager_id', escalation.manager_id,
    'world_id', escalation.world_id,
    'appointment_id', escalation.appointment_id,
    'activity_anchor', escalation.activity_anchor,
    'stage', escalation.stage,
    'display_name', escalation.display_name,
    'email', escalation.email,
    'club_name', escalation.club_name
  ) order by escalation.created_at), '[]'::jsonb)
  into result_value
  from public.manager_inactivity_escalations escalation
  join claimed on claimed.id = escalation.id;

  return result_value;
end;
$$;

create or replace function public.finish_manager_inactivity_escalation(
  p_claim_token uuid,
  p_escalation_id uuid,
  p_message_id text default null,
  p_error text default null
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  affected integer;
begin
  update public.manager_inactivity_escalations
  set status = case when trim(coalesce(p_error, '')) = '' then 'sent' else 'failed' end,
      sent_at = case when trim(coalesce(p_error, '')) = '' then now() else sent_at end,
      resend_message_id = case when trim(coalesce(p_error, '')) = '' then p_message_id else resend_message_id end,
      last_error = nullif(left(trim(coalesce(p_error, '')), 1000), ''),
      updated_at = now()
  where id = p_escalation_id
    and claim_token = p_claim_token
    and status = 'sending';
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.get_manager_notifications_for_user(p_user_id uuid, p_world_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $
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
  where p.user_id = p_user_id
    and p.status = 'active'
    and (
      exists (
        select 1 from public.manager_appointments a
        where a.manager_id = p.id and a.world_id = p_world_id
      )
      or exists (
        select 1 from public.manager_notifications n
        where n.manager_id = p.id and n.world_id = p_world_id
      )
    )
  limit 1;
  if v_manager_id is null then raise exception 'No manager history for this user and world'; end if;

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
$;

create or replace function public.mark_manager_notification_read_for_user(
  p_user_id uuid, p_world_id text, p_notification_id uuid default null, p_all boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $
declare v_manager_id uuid; v_count integer;
begin
  select p.id into v_manager_id
  from public.manager_profiles p
  where p.user_id = p_user_id
    and p.status = 'active'
    and (
      exists (
        select 1 from public.manager_appointments a
        where a.manager_id = p.id and a.world_id = p_world_id
      )
      or exists (
        select 1 from public.manager_notifications n
        where n.manager_id = p.id and n.world_id = p_world_id
      )
    )
  limit 1;
  if v_manager_id is null then raise exception 'No manager history for this user and world'; end if;

  update public.manager_notifications set read_at = coalesce(read_at, now())
  where manager_id = v_manager_id and world_id = p_world_id
    and (p_all or (not p_all and id = p_notification_id));
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',true,'updated',v_count);
end;
$;

revoke all on function public.touch_manager_world_activity_atomic(uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.touch_manager_world_activity_atomic(uuid,text,timestamptz) to service_role;
revoke all on function public.get_manager_notifications_for_user(uuid,text) from public, anon, authenticated;
grant execute on function public.get_manager_notifications_for_user(uuid,text) to service_role;
revoke all on function public.mark_manager_notification_read_for_user(uuid,text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.mark_manager_notification_read_for_user(uuid,text,uuid,boolean) to service_role;

revoke all on function public.claim_manager_inactivity_escalations(uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_manager_inactivity_escalations(uuid,integer) to service_role;
revoke all on function public.finish_manager_inactivity_escalation(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.finish_manager_inactivity_escalation(uuid,uuid,text,text) to service_role;

comment on table public.manager_participation_states is
  'Current hard participation state for a manager appointment. A fresh portal activity event clears caretaker state; removal is historical once the appointment ends.';

comment on table public.manager_inactivity_escalations is
  'Controlled-alpha hard participation enforcement. Published operational dials: 3-day warning/check-in, 7-day caretaker status, 10-day removal.';

commit;
