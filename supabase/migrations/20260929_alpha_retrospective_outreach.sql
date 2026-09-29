-- Alpha 1 retrospective outreach: server-side cohort selection and delivery audit.
-- Email addresses never need to be returned to the browser: the Netlify admin function
-- consumes this RPC with the service role and strips email from dry-run responses.

create table if not exists public.alpha_retrospective_deliveries (
  id uuid primary key default gen_random_uuid(),
  world_id text not null,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  message_id text,
  error text,
  attempted_at timestamptz not null default now()
);

alter table public.alpha_retrospective_deliveries enable row level security;

create or replace function public.admin_get_alpha_retrospective_cohort(
  p_admin_user_id uuid,
  p_world_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1 from manager_profiles
    where user_id = p_admin_user_id and is_admin = true
  ) then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;

  select jsonb_build_object(
    'ok', true,
    'managers', coalesce(jsonb_agg(to_jsonb(x) order by x.first_appointed_at), '[]'::jsonb)
  )
  into result
  from (
    select
      mp.id as manager_id,
      mp.display_name,
      mp.email,
      count(ma.id)::int as appointment_count,
      min(ma.appointed_at) as first_appointed_at,
      max(ma.ended_at) as last_ended_at,
      exists (
        select 1
        from alpha_retrospective_deliveries d
        where d.world_id = p_world_id
          and d.manager_id = mp.id
          and d.message_id is not null
      ) as already_sent
    from manager_profiles mp
    join manager_appointments ma on ma.manager_id = mp.id
    where ma.world_id = p_world_id
      and coalesce(mp.is_admin, false) = false
      and mp.profile_completed = true
      and mp.email is not null
      and mp.email <> ''
    group by mp.id, mp.display_name, mp.email
  ) x;

  return result;
end;
$$;

create or replace function public.admin_record_alpha_retrospective_delivery(
  p_admin_user_id uuid,
  p_world_id text,
  p_manager_id uuid,
  p_message_id text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from manager_profiles
    where user_id = p_admin_user_id and is_admin = true
  ) then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;

  insert into alpha_retrospective_deliveries (
    world_id, manager_id, message_id, error
  ) values (
    p_world_id, p_manager_id, p_message_id, p_error
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_get_alpha_retrospective_cohort(uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_record_alpha_retrospective_delivery(uuid, text, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.admin_get_alpha_retrospective_cohort(uuid, text)
  to service_role;
grant execute on function public.admin_record_alpha_retrospective_delivery(uuid, text, uuid, text, text)
  to service_role;
