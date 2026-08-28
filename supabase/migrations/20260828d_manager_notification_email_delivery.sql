begin;

create table if not exists public.manager_notification_preferences (
  manager_id uuid primary key references public.manager_profiles(id) on delete cascade,
  world_id text not null references public.worlds(id) on delete cascade,
  email_frequency text not null default 'off' check (email_frequency in ('off', 'instant', 'daily')),
  email_transfers boolean not null default true,
  email_social boolean not null default true,
  email_system boolean not null default false,
  daily_digest_hour_utc smallint not null default 8 check (daily_digest_hour_utc between 0 and 23),
  email_start_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.manager_notification_preferences enable row level security;
revoke all on table public.manager_notification_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.manager_notification_preferences to service_role;

create table if not exists public.manager_notification_email_deliveries (
  notification_id uuid primary key references public.manager_notifications(id) on delete cascade,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  status text not null check (status in ('sending', 'sent', 'failed', 'skipped')),
  claim_token uuid,
  claimed_at timestamptz,
  attempted_at timestamptz,
  sent_at timestamptz,
  resend_message_id text,
  last_error text,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists manager_notification_email_delivery_manager_idx
  on public.manager_notification_email_deliveries(manager_id, updated_at desc);

alter table public.manager_notification_email_deliveries enable row level security;
revoke all on table public.manager_notification_email_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.manager_notification_email_deliveries to service_role;

create or replace function public.manager_notification_delivery_category(p_notification_type text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when coalesce(p_notification_type, '') like 'transfer_%' then 'transfers'
    when coalesce(p_notification_type, '') like 'news_%' then 'social'
    else 'system'
  end;
$$;

create or replace function public.get_manager_notification_preferences_for_user(
  p_user_id uuid,
  p_world_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  preference_row public.manager_notification_preferences;
begin
  select profile.id into manager_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;

  if manager_id_value is null then
    raise exception 'No active manager appointment for this user and world';
  end if;

  select * into preference_row
  from public.manager_notification_preferences preference
  where preference.manager_id = manager_id_value
    and preference.world_id = p_world_id;

  return jsonb_build_object(
    'email_frequency', coalesce(preference_row.email_frequency, 'off'),
    'email_transfers', coalesce(preference_row.email_transfers, true),
    'email_social', coalesce(preference_row.email_social, true),
    'email_system', coalesce(preference_row.email_system, false),
    'daily_digest_hour_utc', coalesce(preference_row.daily_digest_hour_utc, 8)
  );
end;
$$;

create or replace function public.update_manager_notification_preferences_for_user(
  p_user_id uuid,
  p_world_id text,
  p_email_frequency text,
  p_email_transfers boolean,
  p_email_social boolean,
  p_email_system boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  frequency_value text := lower(trim(coalesce(p_email_frequency, 'off')));
begin
  if frequency_value not in ('off', 'instant', 'daily') then
    raise exception 'Email frequency must be off, instant or daily';
  end if;

  select profile.id into manager_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;

  if manager_id_value is null then
    raise exception 'No active manager appointment for this user and world';
  end if;

  insert into public.manager_notification_preferences(
    manager_id, world_id, email_frequency, email_transfers, email_social, email_system,
    email_start_at, updated_at
  ) values (
    manager_id_value, p_world_id, frequency_value,
    coalesce(p_email_transfers, true), coalesce(p_email_social, true), coalesce(p_email_system, false),
    case when frequency_value = 'off' then null else now() end,
    now()
  )
  on conflict (manager_id) do update set
    world_id = excluded.world_id,
    email_frequency = excluded.email_frequency,
    email_transfers = excluded.email_transfers,
    email_social = excluded.email_social,
    email_system = excluded.email_system,
    email_start_at = excluded.email_start_at,
    updated_at = excluded.updated_at;

  return public.get_manager_notification_preferences_for_user(p_user_id, p_world_id);
end;
$$;

create or replace function public.claim_manager_notification_email_deliveries(
  p_claim_token uuid,
  p_limit integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result_value jsonb;
begin
  if p_claim_token is null then raise exception 'Claim token is required'; end if;

  with candidates as (
    select notification.id
    from public.manager_notifications notification
    join public.manager_notification_preferences preference
      on preference.manager_id = notification.manager_id
     and preference.world_id = notification.world_id
    left join public.manager_notification_email_deliveries delivery
      on delivery.notification_id = notification.id
    where preference.email_frequency <> 'off'
      and preference.email_start_at is not null
      and notification.created_at >= preference.email_start_at
      and case public.manager_notification_delivery_category(notification.notification_type)
        when 'transfers' then preference.email_transfers
        when 'social' then preference.email_social
        else preference.email_system
      end
      and (
        preference.email_frequency = 'instant'
        or (
          preference.email_frequency = 'daily'
          and extract(hour from (now() at time zone 'UTC'))::integer >= preference.daily_digest_hour_utc
          and notification.created_at < (
            date_trunc('day', now() at time zone 'UTC')
            + make_interval(hours => preference.daily_digest_hour_utc)
          ) at time zone 'UTC'
        )
      )
      and (
        delivery.notification_id is null
        or (
          delivery.status in ('failed', 'sending')
          and delivery.attempts < 3
          and coalesce(delivery.claimed_at, delivery.attempted_at, '-infinity'::timestamptz) < now() - interval '15 minutes'
        )
      )
    order by notification.created_at asc
    limit greatest(1, least(coalesce(p_limit, 100), 250))
    for update of notification skip locked
  ), claimed as (
    insert into public.manager_notification_email_deliveries(
      notification_id, manager_id, status, claim_token, claimed_at, attempts, created_at, updated_at
    )
    select notification.id, notification.manager_id, 'sending', p_claim_token, now(), 1, now(), now()
    from public.manager_notifications notification
    join candidates on candidates.id = notification.id
    on conflict (notification_id) do update set
      status = 'sending',
      claim_token = excluded.claim_token,
      claimed_at = excluded.claimed_at,
      attempts = public.manager_notification_email_deliveries.attempts + 1,
      updated_at = now()
    where public.manager_notification_email_deliveries.status in ('failed', 'sending')
      and public.manager_notification_email_deliveries.attempts < 3
      and coalesce(public.manager_notification_email_deliveries.claimed_at, public.manager_notification_email_deliveries.attempted_at, '-infinity'::timestamptz) < now() - interval '15 minutes'
    returning notification_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'notification_id', notification.id,
    'manager_id', notification.manager_id,
    'email', auth_user.email,
    'email_frequency', preference.email_frequency,
    'notification_type', notification.notification_type,
    'notification_class', notification.notification_class,
    'title', notification.title,
    'body', notification.body,
    'action_url', notification.action_url,
    'created_at', notification.created_at
  ) order by notification.manager_id, notification.created_at), '[]'::jsonb)
  into result_value
  from claimed
  join public.manager_notifications notification on notification.id = claimed.notification_id
  join public.manager_notification_preferences preference on preference.manager_id = notification.manager_id
  join public.manager_profiles profile on profile.id = notification.manager_id
  left join auth.users auth_user on auth_user.id = profile.user_id;

  return result_value;
end;
$$;

create or replace function public.finish_manager_notification_email_deliveries(
  p_claim_token uuid,
  p_notification_ids uuid[],
  p_message_id text default null,
  p_error text default null
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  affected integer;
begin
  update public.manager_notification_email_deliveries delivery
  set status = case when trim(coalesce(p_error, '')) = '' then 'sent' else 'failed' end,
      attempted_at = now(),
      sent_at = case when trim(coalesce(p_error, '')) = '' then now() else delivery.sent_at end,
      resend_message_id = case when trim(coalesce(p_error, '')) = '' then p_message_id else delivery.resend_message_id end,
      last_error = nullif(left(trim(coalesce(p_error, '')), 1000), ''),
      updated_at = now()
  where delivery.claim_token = p_claim_token
    and delivery.notification_id = any(coalesce(p_notification_ids, '{}'::uuid[]))
    and delivery.status = 'sending';
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.manager_notification_delivery_category(text) from public, anon, authenticated;
grant execute on function public.manager_notification_delivery_category(text) to service_role;
revoke all on function public.get_manager_notification_preferences_for_user(uuid,text) from public, anon, authenticated;
grant execute on function public.get_manager_notification_preferences_for_user(uuid,text) to service_role;
revoke all on function public.update_manager_notification_preferences_for_user(uuid,text,text,boolean,boolean,boolean) from public, anon, authenticated;
grant execute on function public.update_manager_notification_preferences_for_user(uuid,text,text,boolean,boolean,boolean) to service_role;
revoke all on function public.claim_manager_notification_email_deliveries(uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_manager_notification_email_deliveries(uuid,integer) to service_role;
revoke all on function public.finish_manager_notification_email_deliveries(uuid,uuid[],text,text) from public, anon, authenticated;
grant execute on function public.finish_manager_notification_email_deliveries(uuid,uuid[],text,text) to service_role;

comment on table public.manager_notification_preferences is
  'Manager-controlled external notification delivery preferences. In-app notifications remain canonical and always available.';
comment on table public.manager_notification_email_deliveries is
  'Server-only delivery ledger for manager notification emails, with bounded retry and Resend message tracking.';

commit;
