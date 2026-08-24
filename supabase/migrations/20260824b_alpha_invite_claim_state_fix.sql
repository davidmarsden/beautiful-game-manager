begin;

create or replace function public.admin_upsert_alpha_invite(
  p_admin_user_id uuid,
  p_world_id text,
  p_email text,
  p_allowed_club_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
  v_invite_id uuid;
begin
  select id into v_admin_id
  from public.manager_profiles
  where user_id = p_admin_user_id
    and is_admin = true
  limit 1;

  if v_admin_id is null then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;

  if length(trim(coalesce(p_email, ''))) < 3 then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_allowed_club_ids, '{}'::text[])) club_id
    where not exists (
      select 1
      from public.clubs c
      where c.world_id = p_world_id
        and c.id = club_id
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_club_allowlist');
  end if;

  insert into public.alpha_tester_invites (
    world_id,
    email,
    status,
    allowed_club_ids,
    created_by_manager_id
  )
  values (
    p_world_id,
    lower(trim(p_email)),
    'invited',
    coalesce(p_allowed_club_ids, '{}'::text[]),
    v_admin_id
  )
  on conflict (world_id, (lower(email))) do update
    set status = case
          when alpha_tester_invites.status = 'claimed'
            and alpha_tester_invites.claimed_manager_id is not null
            and alpha_tester_invites.claimed_club_id is not null
            and exists (
              select 1
              from public.manager_appointments a
              where a.world_id = alpha_tester_invites.world_id
                and a.manager_id = alpha_tester_invites.claimed_manager_id
                and a.club_id = alpha_tester_invites.claimed_club_id
                and a.status = 'active'
            ) then 'claimed'
          else 'invited'
        end,
        claimed_manager_id = case
          when alpha_tester_invites.status = 'claimed'
            and alpha_tester_invites.claimed_manager_id is not null
            and alpha_tester_invites.claimed_club_id is not null
            and exists (
              select 1
              from public.manager_appointments a
              where a.world_id = alpha_tester_invites.world_id
                and a.manager_id = alpha_tester_invites.claimed_manager_id
                and a.club_id = alpha_tester_invites.claimed_club_id
                and a.status = 'active'
            ) then alpha_tester_invites.claimed_manager_id
          else null
        end,
        claimed_club_id = case
          when alpha_tester_invites.status = 'claimed'
            and alpha_tester_invites.claimed_manager_id is not null
            and alpha_tester_invites.claimed_club_id is not null
            and exists (
              select 1
              from public.manager_appointments a
              where a.world_id = alpha_tester_invites.world_id
                and a.manager_id = alpha_tester_invites.claimed_manager_id
                and a.club_id = alpha_tester_invites.claimed_club_id
                and a.status = 'active'
            ) then alpha_tester_invites.claimed_club_id
          else null
        end,
        claimed_at = case
          when alpha_tester_invites.status = 'claimed'
            and alpha_tester_invites.claimed_manager_id is not null
            and alpha_tester_invites.claimed_club_id is not null
            and exists (
              select 1
              from public.manager_appointments a
              where a.world_id = alpha_tester_invites.world_id
                and a.manager_id = alpha_tester_invites.claimed_manager_id
                and a.club_id = alpha_tester_invites.claimed_club_id
                and a.status = 'active'
            ) then alpha_tester_invites.claimed_at
          else null
        end,
        allowed_club_ids = excluded.allowed_club_ids,
        created_by_manager_id = excluded.created_by_manager_id,
        updated_at = now()
  returning id into v_invite_id;

  return jsonb_build_object('ok', true, 'invite_id', v_invite_id);
end;
$$;

revoke all on function public.admin_upsert_alpha_invite(uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.admin_upsert_alpha_invite(uuid, text, text, text[]) to service_role;

commit;
