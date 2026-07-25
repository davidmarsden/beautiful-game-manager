begin;

create or replace function public.submit_bulk_registration_commands(
  p_world_id text,
  p_manager_id uuid,
  p_club_id text,
  p_requested_player_ids text[],
  p_current_registered_ids text[],
  p_owned_senior_ids text[],
  p_registration_limit integer,
  p_effective_season_id text,
  p_effective_matchday integer,
  p_batch_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  player_id_value text;
  pending_type text;
  desired_registered boolean;
  effective_registered boolean;
  canonical_registered boolean;
  command_type_value text;
  request_key_value text;
  submitted jsonb := '[]'::jsonb;
  phase integer;
  requested_count integer;
  unknown_players text[];
begin
  if p_manager_id <> public.current_manager_id() then
    raise exception 'Manager identity does not match the authenticated session';
  end if;

  if not exists (
    select 1
    from public.manager_appointments appointment
    where appointment.manager_id = p_manager_id
      and appointment.world_id = p_world_id
      and appointment.club_id = p_club_id
      and appointment.status = 'active'
  ) then
    raise exception 'No active appointment matches this manager, world and club';
  end if;

  select count(distinct requested_id)
  into requested_count
  from unnest(coalesce(p_requested_player_ids, array[]::text[])) requested_id;

  if requested_count > p_registration_limit then
    raise exception 'Senior registration is limited to % players', p_registration_limit;
  end if;

  select array_agg(requested_id order by requested_id)
  into unknown_players
  from (
    select distinct requested_id
    from unnest(coalesce(p_requested_player_ids, array[]::text[])) requested_id
    where not (requested_id = any(coalesce(p_owned_senior_ids, array[]::text[])))
  ) unknown;

  if coalesce(cardinality(unknown_players), 0) > 0 then
    raise exception 'Registration contains players not owned by this club: %', array_to_string(unknown_players, ', ');
  end if;

  -- Removals are submitted before additions so a full 25-player squad can be changed safely.
  for phase in 0..1 loop
    for player_id_value in
      select distinct owned_id
      from unnest(coalesce(p_owned_senior_ids, array[]::text[])) owned_id
      where (owned_id = any(coalesce(p_requested_player_ids, array[]::text[]))) = (phase = 1)
      order by owned_id
    loop
      desired_registered := player_id_value = any(coalesce(p_requested_player_ids, array[]::text[]));
      canonical_registered := player_id_value = any(coalesce(p_current_registered_ids, array[]::text[]));

      select command.command_type
      into pending_type
      from public.manager_world_commands command
      where command.world_id = p_world_id
        and command.manager_id = p_manager_id
        and command.club_id = p_club_id
        and command.status = 'pending'
        and command.command_type in ('register_player', 'unregister_player')
        and coalesce(command.command_payload->>'playerId', command.command_payload->>'player_id') = player_id_value
      order by command.submitted_at desc, command.id desc
      limit 1;

      effective_registered := case
        when pending_type = 'register_player' then true
        when pending_type = 'unregister_player' then false
        else canonical_registered
      end;

      if effective_registered is distinct from desired_registered then
        command_type_value := case when desired_registered then 'register_player' else 'unregister_player' end;
        request_key_value := encode(digest(
          concat_ws('|', p_world_id, p_manager_id::text, p_batch_id, command_type_value, player_id_value),
          'sha256'
        ), 'hex');

        perform public.submit_manager_world_command(
          p_world_id,
          p_manager_id,
          p_club_id,
          command_type_value,
          jsonb_build_object(
            'playerId', player_id_value,
            'batch_id', p_batch_id,
            'client_request_id', request_key_value
          ),
          p_effective_season_id,
          p_effective_matchday,
          request_key_value
        );

        submitted := submitted || jsonb_build_array(jsonb_build_object(
          'player_id', player_id_value,
          'action', case when desired_registered then 'register' else 'remove' end
        ));
      end if;

      pending_type := null;
    end loop;
  end loop;

  return jsonb_build_object(
    'accepted', true,
    'batch_id', p_batch_id,
    'requested_count', requested_count,
    'command_count', jsonb_array_length(submitted),
    'unchanged_count', requested_count - (
      select count(*)
      from jsonb_array_elements(submitted) item
      where item->>'action' = 'register'
    ),
    'submitted', submitted
  );
end;
$$;

revoke all on function public.submit_bulk_registration_commands(
  text, uuid, text, text[], text[], text[], integer, text, integer, text
) from public, anon;
grant execute on function public.submit_bulk_registration_commands(
  text, uuid, text, text[], text[], text[], integer, text, integer, text
) to authenticated;

commit;
