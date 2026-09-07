begin;

alter table public.alpha_tester_invites
  drop constraint if exists alpha_tester_invites_status_check;

alter table public.alpha_tester_invites
  add constraint alpha_tester_invites_status_check
  check (status in ('invited','claimed','pool','revoked'));

create or replace function public.get_alpha_claim_context_for_user(
  p_user_id uuid,
  p_world_id text default 'tbg-world-1'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_manager public.manager_profiles%rowtype;
  v_invite public.alpha_tester_invites%rowtype;
  v_appointment public.manager_appointments%rowtype;
  v_clubs jsonb := '[]'::jsonb;
begin
  select * into v_manager from public.manager_profiles where user_id = p_user_id limit 1;
  if v_manager.id is null then
    return jsonb_build_object('invited', false, 'reason', 'manager_profile_missing');
  end if;

  select * into v_appointment
  from public.manager_appointments
  where manager_id = v_manager.id and world_id = p_world_id and status = 'active'
  limit 1;

  select * into v_invite
  from public.alpha_tester_invites
  where world_id = p_world_id
    and lower(email) = lower(coalesce(v_manager.email, ''))
    and status <> 'revoked'
  limit 1;

  if v_appointment.id is not null then
    return jsonb_build_object(
      'invited', v_invite.id is not null,
      'profile_completed', coalesce(v_manager.profile_completed, false),
      'already_appointed', true,
      'appointment', jsonb_build_object(
        'id', v_appointment.id,
        'world_id', v_appointment.world_id,
        'club_id', v_appointment.club_id,
        'appointed_at', v_appointment.appointed_at
      ),
      'clubs', '[]'::jsonb
    );
  end if;

  if v_invite.id is null then
    return jsonb_build_object(
      'invited', false,
      'profile_completed', coalesce(v_manager.profile_completed, false),
      'already_appointed', false,
      'reason', 'not_invited',
      'clubs', '[]'::jsonb
    );
  end if;

  if v_invite.status = 'pool' then
    return jsonb_build_object(
      'invited', false,
      'profile_completed', coalesce(v_manager.profile_completed, false),
      'already_appointed', false,
      'reason', 'awaiting_reappointment',
      'clubs', '[]'::jsonb
    );
  end if;

  if v_invite.status <> 'invited' then
    return jsonb_build_object(
      'invited', false,
      'profile_completed', coalesce(v_manager.profile_completed, false),
      'already_appointed', false,
      'reason', 'not_invited',
      'clubs', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'club_id', c.id,
    'club_name', c.name,
    'short_name', c.short_name,
    'division_id', c.division_id,
    'world_rank', c.world_rank
  ) order by c.division_id nulls last, c.world_rank nulls last, c.name), '[]'::jsonb)
  into v_clubs
  from public.clubs c
  where c.world_id = p_world_id
    and (cardinality(v_invite.allowed_club_ids) = 0 or c.id = any(v_invite.allowed_club_ids))
    and not exists (
      select 1 from public.manager_appointments a
      where a.world_id = p_world_id and a.club_id = c.id and a.status = 'active'
    );

  return jsonb_build_object(
    'invited', true,
    'invite_id', v_invite.id,
    'profile_completed', coalesce(v_manager.profile_completed, false),
    'already_appointed', false,
    'clubs', v_clubs
  );
end;
$$;

create or replace function public.claim_alpha_club_for_user(
  p_user_id uuid,
  p_world_id text,
  p_club_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_manager public.manager_profiles%rowtype;
  v_invite public.alpha_tester_invites%rowtype;
  v_existing public.manager_appointments%rowtype;
  v_appointment_id uuid;
begin
  select * into v_manager
  from public.manager_profiles
  where user_id = p_user_id and status = 'active'
  limit 1;

  if v_manager.id is null then return jsonb_build_object('ok', false, 'code', 'manager_profile_missing'); end if;
  if not coalesce(v_manager.profile_completed, false) then return jsonb_build_object('ok', false, 'code', 'profile_incomplete'); end if;

  select * into v_invite
  from public.alpha_tester_invites
  where world_id = p_world_id
    and lower(email) = lower(coalesce(v_manager.email, ''))
    and status <> 'revoked'
  for update;

  if v_invite.id is null then return jsonb_build_object('ok', false, 'code', 'not_invited'); end if;
  if v_invite.status = 'pool' then return jsonb_build_object('ok', false, 'code', 'awaiting_reappointment'); end if;
  if v_invite.status <> 'invited' then return jsonb_build_object('ok', false, 'code', 'not_invited'); end if;

  perform pg_advisory_xact_lock(hashtextextended(p_world_id || ':' || p_club_id, 291));
  perform pg_advisory_xact_lock(hashtextextended(p_world_id || ':' || v_manager.id::text, 292));

  select * into v_existing
  from public.manager_appointments
  where world_id = p_world_id and manager_id = v_manager.id and status = 'active'
  limit 1;

  if v_existing.id is not null then
    if v_existing.club_id = p_club_id then
      return jsonb_build_object('ok', true, 'idempotent', true, 'appointment_id', v_existing.id, 'club_id', v_existing.club_id);
    end if;
    return jsonb_build_object('ok', false, 'code', 'manager_already_appointed', 'club_id', v_existing.club_id);
  end if;

  if cardinality(v_invite.allowed_club_ids) > 0 and not (p_club_id = any(v_invite.allowed_club_ids)) then
    return jsonb_build_object('ok', false, 'code', 'club_not_allowed');
  end if;
  if not exists (select 1 from public.clubs c where c.id = p_club_id and c.world_id = p_world_id) then
    return jsonb_build_object('ok', false, 'code', 'club_not_found');
  end if;
  if exists (select 1 from public.manager_appointments a where a.world_id = p_world_id and a.club_id = p_club_id and a.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'club_taken');
  end if;

  insert into public.manager_appointments (manager_id, world_id, club_id, control_type, status)
  values (v_manager.id, p_world_id, p_club_id, 'human', 'active')
  on conflict do nothing
  returning id into v_appointment_id;

  if v_appointment_id is null then
    if exists (select 1 from public.manager_appointments a where a.world_id = p_world_id and a.club_id = p_club_id and a.status = 'active') then
      return jsonb_build_object('ok', false, 'code', 'club_taken');
    end if;
    return jsonb_build_object('ok', false, 'code', 'claim_conflict');
  end if;

  update public.alpha_tester_invites
  set status = 'claimed', claimed_manager_id = v_manager.id, claimed_club_id = p_club_id, claimed_at = now(), updated_at = now()
  where id = v_invite.id;

  insert into public.alpha_appointment_events (world_id, manager_id, appointment_id, event_type, to_club_id, actor_manager_id)
  values (p_world_id, v_manager.id, v_appointment_id, 'claimed', p_club_id, v_manager.id);

  return jsonb_build_object('ok', true, 'appointment_id', v_appointment_id, 'club_id', p_club_id);
end;
$$;

create or replace function public.admin_end_alpha_appointment(
  p_admin_user_id uuid,
  p_appointment_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
  v_appointment public.manager_appointments%rowtype;
begin
  select id into v_admin_id from public.manager_profiles where user_id = p_admin_user_id and is_admin = true limit 1;
  if v_admin_id is null then return jsonb_build_object('ok', false, 'code', 'admin_required'); end if;

  select * into v_appointment from public.manager_appointments where id = p_appointment_id for update;
  if v_appointment.id is null or v_appointment.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'active_appointment_not_found');
  end if;

  update public.manager_appointments set status = 'ended', ended_at = now() where id = v_appointment.id;

  update public.alpha_tester_invites
  set status = 'pool', claimed_manager_id = null, claimed_club_id = null, claimed_at = null, updated_at = now()
  where world_id = v_appointment.world_id and claimed_manager_id = v_appointment.manager_id and status = 'claimed';

  insert into public.alpha_appointment_events (
    world_id, manager_id, appointment_id, event_type, from_club_id, actor_manager_id, detail
  ) values (
    v_appointment.world_id, v_appointment.manager_id, v_appointment.id, 'ended', v_appointment.club_id, v_admin_id,
    jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), ''))
  );

  return jsonb_build_object('ok', true, 'ended_appointment_id', v_appointment.id, 'club_id', v_appointment.club_id);
end;
$$;

-- Production repair for managers removed after the friendly inactivity warning.
-- Match by governed appointment event semantics rather than generated IDs.
update public.alpha_tester_invites i
set status = 'pool', claimed_manager_id = null, claimed_club_id = null, claimed_at = null, updated_at = now()
where i.status = 'invited'
  and exists (
    select 1
    from public.manager_profiles m
    join public.alpha_appointment_events e on e.manager_id = m.id
    where lower(m.email) = lower(i.email)
      and e.world_id = i.world_id
      and e.event_type = 'ended'
      and e.detail->>'reason' = 'Controlled-alpha inactivity after friendly warning and Monday deadline.'
  );

commit;
