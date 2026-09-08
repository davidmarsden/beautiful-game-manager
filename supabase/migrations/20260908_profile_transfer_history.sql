-- Profile transfer history: query completed canonical moves by player/club before any global limit.
-- Includes paid external acquisitions with their governed EUR fee.

begin;

create or replace function public.get_profile_transfer_history_for_user(
  p_user_id uuid,
  p_world_id text,
  p_player_id text default null,
  p_club_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  cache_row public.world_read_model_cache;
  canonical_checksum text;
  result_value jsonb;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;
  if trim(coalesce(p_world_id, '')) = '' then raise exception 'World is required'; end if;
  if nullif(trim(coalesce(p_player_id, '')), '') is null
     and nullif(trim(coalesce(p_club_id, '')), '') is null then
    raise exception 'Player or club is required';
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

  select save_checksum into canonical_checksum
  from public.canonical_world_saves where world_id = p_world_id limit 1;
  select * into cache_row
  from public.world_read_model_cache where world_id = p_world_id limit 1;
  if cache_row.read_model is null or canonical_checksum is null or cache_row.source_checksum <> canonical_checksum then
    raise exception 'World read model is refreshing; please retry shortly';
  end if;

  with deal_events as (
    select
      concat(deal.id::text, ':', player_leg.sequence_no::text) as event_id,
      'transfer_deal'::text as source,
      case when player_count.player_count > 1 then 'exchange' else 'permanent' end as transfer_type,
      player_leg.player_id,
      coalesce(
        cache_row.read_model #>> array['squad_cycle','players',player_leg.player_id,'display_name'],
        cache_row.read_model #>> array['squad_cycle','players',player_leg.player_id,'player_name'],
        player_leg.player_id
      ) as player_name,
      player_leg.from_club_id,
      coalesce(
        cache_row.read_model #>> array['club_profiles',player_leg.from_club_id,'club_name'],
        cache_row.read_model #>> array['club_profiles',player_leg.from_club_id,'canonical_name'],
        player_leg.from_club_id
      ) as from_club_name,
      player_leg.to_club_id,
      coalesce(
        cache_row.read_model #>> array['club_profiles',player_leg.to_club_id,'club_name'],
        cache_row.read_model #>> array['club_profiles',player_leg.to_club_id,'canonical_name'],
        player_leg.to_club_id
      ) as to_club_name,
      coalesce((
        select cash.amount
        from public.transfer_deal_legs cash
        where cash.revision_id = revision.id
          and cash.leg_type = 'cash'
          and cash.from_club_id = player_leg.to_club_id
          and cash.to_club_id = player_leg.from_club_id
        order by cash.sequence_no
        limit 1
      ), 0)::bigint as fee,
      'GBP'::text as fee_currency,
      player_count.player_count as package_player_count,
      case
        when coalesce(player_leg.terms->>'contract_years','') ~ '^[0-9]+$'
        then greatest(1, least((player_leg.terms->>'contract_years')::integer, 5))
        else null
      end as contract_years,
      coalesce(deal.terminal_at, deal.binding_at, deal.updated_at) as completed_at
    from public.transfer_deals deal
    join public.transfer_deal_revisions revision
      on revision.deal_id = deal.id
     and revision.revision_no = deal.current_revision_no
    join public.transfer_deal_legs player_leg
      on player_leg.revision_id = revision.id
     and player_leg.leg_type = 'permanent_transfer'
     and player_leg.player_id is not null
    join lateral (
      select count(*)::integer as player_count
      from public.transfer_deal_legs counted
      where counted.revision_id = revision.id
        and counted.leg_type = 'permanent_transfer'
        and counted.player_id is not null
    ) player_count on true
    where deal.world_id = p_world_id
      and deal.status = 'completed'
      and (nullif(trim(coalesce(p_player_id, '')), '') is null or player_leg.player_id = p_player_id)
      and (
        nullif(trim(coalesce(p_club_id, '')), '') is null
        or player_leg.from_club_id = p_club_id
        or player_leg.to_club_id = p_club_id
      )
  ), acquisition_events as (
    select
      concat('acquisition:', acquisition.id::text) as event_id,
      'player_acquisition'::text as source,
      case when acquisition.acquisition_type = 'external' then 'external' else 'free_agent' end as transfer_type,
      acquisition.player_id,
      acquisition.player_name,
      null::text as from_club_id,
      case when acquisition.acquisition_type = 'external' then 'External market' else 'Free agent' end as from_club_name,
      acquisition.club_id as to_club_id,
      coalesce(
        cache_row.read_model #>> array['club_profiles',acquisition.club_id,'club_name'],
        cache_row.read_model #>> array['club_profiles',acquisition.club_id,'canonical_name'],
        acquisition.club_id
      ) as to_club_name,
      case
        when acquisition.acquisition_type = 'external'
          and coalesce(acquisition.player_snapshot->>'external_acquisition_fee_eur','') ~ '^[0-9]+$'
        then (acquisition.player_snapshot->>'external_acquisition_fee_eur')::bigint
        else 0::bigint
      end as fee,
      case when acquisition.acquisition_type = 'external' then 'EUR' else 'GBP' end as fee_currency,
      1::integer as package_player_count,
      acquisition.contract_years,
      coalesce(acquisition.terminal_at, acquisition.updated_at, acquisition.created_at) as completed_at
    from public.player_acquisitions acquisition
    where acquisition.world_id = p_world_id
      and acquisition.status = 'completed'
      and (nullif(trim(coalesce(p_player_id, '')), '') is null or acquisition.player_id = p_player_id)
      and (nullif(trim(coalesce(p_club_id, '')), '') is null or acquisition.club_id = p_club_id)
  ), all_events as (
    select * from deal_events
    union all
    select * from acquisition_events
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id', event_id,
    'source', source,
    'transfer_type', transfer_type,
    'player_id', player_id,
    'player_name', player_name,
    'from_club_id', from_club_id,
    'from_club_name', from_club_name,
    'to_club_id', to_club_id,
    'to_club_name', to_club_name,
    'fee', fee,
    'fee_currency', fee_currency,
    'package_player_count', package_player_count,
    'contract_years', contract_years,
    'completed_at', completed_at
  ) order by completed_at desc), '[]'::jsonb)
  into result_value
  from all_events;

  return result_value;
end;
$$;

revoke all on function public.get_profile_transfer_history_for_user(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.get_profile_transfer_history_for_user(uuid,text,text,text) to service_role;

commit;
