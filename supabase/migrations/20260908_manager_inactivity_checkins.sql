begin;

create table if not exists public.manager_inactivity_checkins (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  world_id text not null references public.worlds(id) on delete cascade,
  appointment_id uuid not null references public.manager_appointments(id) on delete cascade,
  activity_anchor timestamptz not null,
  status text not null default 'sending' check (status in ('sending','sent','failed')),
  claim_token uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  resend_message_id text,
  last_error text,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, activity_anchor)
);

create index if not exists manager_inactivity_checkins_due_idx
  on public.manager_inactivity_checkins(status, claimed_at, attempts);

alter table public.manager_inactivity_checkins enable row level security;
revoke all on table public.manager_inactivity_checkins from public, anon, authenticated;
grant select, insert, update, delete on table public.manager_inactivity_checkins to service_role;

create or replace function public.claim_manager_inactivity_checkins(
  p_claim_token uuid,
  p_limit integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  result_value jsonb;
begin
  if p_claim_token is null then raise exception 'Claim token is required'; end if;

  with due as (
    select
      appointment.id as appointment_id,
      appointment.manager_id,
      appointment.world_id,
      club.name as club_name,
      profile.display_name,
      auth_user.email,
      greatest(coalesce(auth_user.last_sign_in_at, appointment.appointed_at), appointment.appointed_at) as activity_anchor
    from public.manager_appointments appointment
    join public.manager_profiles profile on profile.id = appointment.manager_id
    join public.clubs club on club.id = appointment.club_id
    left join auth.users auth_user on auth_user.id = profile.user_id
    where appointment.status = 'active'
      and appointment.control_type = 'human'
      and profile.status = 'active'
      and auth_user.email is not null
      and greatest(coalesce(auth_user.last_sign_in_at, appointment.appointed_at), appointment.appointed_at) <= now() - interval '3 days'
  ), inserted as (
    insert into public.manager_inactivity_checkins(
      manager_id, world_id, appointment_id, activity_anchor,
      status, claim_token, claimed_at, attempts, created_at, updated_at
    )
    select
      due.manager_id, due.world_id, due.appointment_id, due.activity_anchor,
      'sending', p_claim_token, now(), 1, now(), now()
    from due
    on conflict (appointment_id, activity_anchor) do nothing
    returning id, manager_id, world_id, appointment_id, activity_anchor
  ), retried as (
    update public.manager_inactivity_checkins checkin
    set status = 'sending',
        claim_token = p_claim_token,
        claimed_at = now(),
        attempts = checkin.attempts + 1,
        updated_at = now()
    where checkin.id in (
      select existing.id
      from public.manager_inactivity_checkins existing
      join due on due.appointment_id = existing.appointment_id
              and due.activity_anchor = existing.activity_anchor
      where existing.status in ('failed','sending')
        and existing.attempts < 3
        and coalesce(existing.claimed_at, '-infinity'::timestamptz) < now() - interval '15 minutes'
      order by existing.created_at
      limit greatest(1, least(coalesce(p_limit, 100), 250))
      for update of existing skip locked
    )
    returning checkin.id, checkin.manager_id, checkin.world_id, checkin.appointment_id, checkin.activity_anchor
  ), claimed as (
    select * from inserted
    union all
    select * from retried
  ), notified as (
    insert into public.manager_notifications(
      world_id, manager_id, notification_type, notification_class,
      title, body, action_url, source_type, source_id, dedupe_key
    )
    select
      claimed.world_id,
      claimed.manager_id,
      'participation_inactivity',
      'action_required',
      'We haven''t seen you for 3 days',
      'Your club is still yours, but the controlled alpha depends on active managers. Please log back in when you can so we know you''re still taking part.',
      '/',
      'manager_participation',
      claimed.appointment_id::text,
      'manager_inactivity:' || claimed.appointment_id::text || ':' || extract(epoch from claimed.activity_anchor)::bigint::text
    from claimed
    on conflict (dedupe_key) do nothing
    returning id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'checkin_id', checkin.id,
    'manager_id', checkin.manager_id,
    'world_id', checkin.world_id,
    'appointment_id', checkin.appointment_id,
    'activity_anchor', checkin.activity_anchor,
    'display_name', profile.display_name,
    'email', auth_user.email,
    'club_name', club.name
  ) order by checkin.created_at), '[]'::jsonb)
  into result_value
  from public.manager_inactivity_checkins checkin
  join claimed on claimed.id = checkin.id
  join public.manager_profiles profile on profile.id = checkin.manager_id
  join public.manager_appointments appointment on appointment.id = checkin.appointment_id
  join public.clubs club on club.id = appointment.club_id
  left join auth.users auth_user on auth_user.id = profile.user_id;

  return result_value;
end;
$$;

create or replace function public.finish_manager_inactivity_checkin(
  p_claim_token uuid,
  p_checkin_id uuid,
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
  update public.manager_inactivity_checkins
  set status = case when trim(coalesce(p_error, '')) = '' then 'sent' else 'failed' end,
      sent_at = case when trim(coalesce(p_error, '')) = '' then now() else sent_at end,
      resend_message_id = case when trim(coalesce(p_error, '')) = '' then p_message_id else resend_message_id end,
      last_error = nullif(left(trim(coalesce(p_error, '')), 1000), ''),
      updated_at = now()
  where id = p_checkin_id
    and claim_token = p_claim_token
    and status = 'sending';
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.claim_manager_inactivity_checkins(uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_manager_inactivity_checkins(uuid,integer) to service_role;
revoke all on function public.finish_manager_inactivity_checkin(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.finish_manager_inactivity_checkin(uuid,uuid,text,text) to service_role;

comment on table public.manager_inactivity_checkins is
  'Operational three-day inactivity check-ins for active human manager appointments. One message is sent per inactivity episode; a new login resets the episode anchor.';

commit;
