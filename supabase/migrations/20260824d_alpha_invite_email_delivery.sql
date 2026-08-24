begin;

alter table public.alpha_tester_invites
  add column if not exists email_last_attempt_at timestamptz,
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_message_id text,
  add column if not exists email_last_error text;

create or replace function public.get_alpha_admin_context_for_user(
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
  v_invites jsonb;
  v_appointments jsonb;
  v_clubs jsonb;
begin
  select * into v_admin from public.manager_profiles where user_id = p_user_id limit 1;
  if v_admin.id is null or not v_admin.is_admin then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'email', i.email,
    'status', i.status,
    'allowed_club_ids', to_jsonb(i.allowed_club_ids),
    'claimed_manager_id', i.claimed_manager_id,
    'claimed_club_id', i.claimed_club_id,
    'claimed_at', i.claimed_at,
    'email_last_attempt_at', i.email_last_attempt_at,
    'email_sent_at', i.email_sent_at,
    'email_message_id', i.email_message_id,
    'email_last_error', i.email_last_error,
    'created_at', i.created_at
  ) order by i.created_at desc), '[]'::jsonb)
  into v_invites
  from public.alpha_tester_invites i
  where i.world_id = p_world_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'appointment_id', a.id,
    'manager_id', a.manager_id,
    'manager_name', m.display_name,
    'manager_email', m.email,
    'club_id', a.club_id,
    'club_name', c.name,
    'appointed_at', a.appointed_at
  ) order by a.appointed_at desc), '[]'::jsonb)
  into v_appointments
  from public.manager_appointments a
  join public.manager_profiles m on m.id = a.manager_id
  join public.clubs c on c.id = a.club_id
  where a.world_id = p_world_id and a.status = 'active' and a.control_type = 'human';

  select coalesce(jsonb_agg(jsonb_build_object(
    'club_id', c.id,
    'club_name', c.name,
    'division_id', c.division_id,
    'world_rank', c.world_rank,
    'vacant', not exists (
      select 1 from public.manager_appointments a
      where a.world_id = p_world_id and a.club_id = c.id and a.status = 'active'
    )
  ) order by c.division_id nulls last, c.world_rank nulls last, c.name), '[]'::jsonb)
  into v_clubs
  from public.clubs c
  where c.world_id = p_world_id;

  return jsonb_build_object('ok', true, 'invites', v_invites, 'appointments', v_appointments, 'clubs', v_clubs);
end;
$$;

create or replace function public.admin_record_alpha_invite_email_delivery(
  p_admin_user_id uuid,
  p_invite_id uuid,
  p_message_id text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
  v_invite public.alpha_tester_invites%rowtype;
begin
  select id into v_admin_id
  from public.manager_profiles
  where user_id = p_admin_user_id and is_admin = true
  limit 1;
  if v_admin_id is null then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;

  select * into v_invite
  from public.alpha_tester_invites
  where id = p_invite_id
  for update;
  if v_invite.id is null then
    return jsonb_build_object('ok', false, 'code', 'invite_not_found');
  end if;

  update public.alpha_tester_invites
  set email_last_attempt_at = now(),
      email_sent_at = case when nullif(trim(coalesce(p_message_id, '')), '') is not null then now() else email_sent_at end,
      email_message_id = case when nullif(trim(coalesce(p_message_id, '')), '') is not null then trim(p_message_id) else email_message_id end,
      email_last_error = nullif(trim(coalesce(p_error, '')), ''),
      updated_at = now()
  where id = p_invite_id;

  return jsonb_build_object('ok', true, 'invite_id', p_invite_id);
end;
$$;

revoke all on function public.get_alpha_admin_context_for_user(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_record_alpha_invite_email_delivery(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_alpha_admin_context_for_user(uuid, text) to service_role;
grant execute on function public.admin_record_alpha_invite_email_delivery(uuid, uuid, text, text) to service_role;

commit;
