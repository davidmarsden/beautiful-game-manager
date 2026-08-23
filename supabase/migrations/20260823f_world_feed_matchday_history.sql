-- #290 review follow-up: make matchday feed projection season-safe and gap-safe.

begin;

create or replace function public.sync_world_feed_system_items(p_world_id text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cache_row public.world_read_model_cache;
  canonical_row public.canonical_world_saves;
  inserted_count integer := 0;
  row_count_value integer := 0;
  current_season_id text;
begin
  if trim(coalesce(p_world_id, '')) = '' then raise exception 'World is required'; end if;

  select * into canonical_row from public.canonical_world_saves where world_id = p_world_id limit 1;
  select * into cache_row from public.world_read_model_cache where world_id = p_world_id limit 1;
  if canonical_row.world_id is null or cache_row.read_model is null or cache_row.source_checksum <> canonical_row.save_checksum then
    raise exception 'World read model is refreshing; please retry shortly';
  end if;

  current_season_id := coalesce(
    canonical_row.season_id,
    cache_row.read_model #>> '{matchday_cycle,season_id}',
    cache_row.read_model #>> '{squad_cycle,season_id}',
    'season-' || coalesce(canonical_row.season_number, 1)::text
  );

  insert into public.world_feed_items(
    world_id, item_type, actor_manager_id, actor_club_id, title, body, source_key,
    related_club_id, metadata, created_at
  )
  select
    appointment.world_id,
    'manager_appointment',
    profile.id,
    appointment.club_id,
    'Manager appointed',
    profile.display_name || ' has taken charge of ' || coalesce(
      cache_row.read_model #>> array['club_profiles',appointment.club_id,'club_name'],
      cache_row.read_model #>> array['club_profiles',appointment.club_id,'canonical_name'],
      appointment.club_id
    ) || '.',
    'appointment:' || appointment.id::text,
    appointment.club_id,
    jsonb_build_object('appointment_id', appointment.id, 'control_type', appointment.control_type),
    coalesce(appointment.appointed_at, appointment.created_at)
  from public.manager_appointments appointment
  join public.manager_profiles profile on profile.id = appointment.manager_id
  where appointment.world_id = p_world_id
    and appointment.status = 'active'
  on conflict (world_id, source_key) where source_key is not null do nothing;
  get diagnostics row_count_value = row_count;
  inserted_count := inserted_count + row_count_value;

  insert into public.world_feed_items(
    world_id, item_type, title, body, source_key, related_deal_id, metadata, created_at
  )
  select
    deal.world_id,
    'transfer_completed',
    case
      when leg_summary.player_count = 1 then 'Transfer completed: ' || leg_summary.primary_player_name
      else leg_summary.player_count::text || '-player deal completed'
    end,
    leg_summary.summary_text,
    'transfer:' || deal.id::text,
    deal.id,
    jsonb_build_object('deal_id', deal.id, 'revision_no', deal.current_revision_no, 'player_count', leg_summary.player_count),
    coalesce(deal.terminal_at, deal.updated_at)
  from public.transfer_deals deal
  join public.transfer_deal_revisions revision
    on revision.deal_id = deal.id and revision.revision_no = deal.current_revision_no
  cross join lateral (
    select
      count(*) filter (where leg.leg_type = 'permanent_transfer')::integer as player_count,
      coalesce(max(case when leg.leg_type = 'permanent_transfer' then coalesce(
        cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'display_name'],
        cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'player_name'],
        leg.player_id
      ) end), 'Transfer') as primary_player_name,
      string_agg(
        case
          when leg.leg_type = 'permanent_transfer' then
            coalesce(cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'display_name'], cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'player_name'], leg.player_id)
            || ': ' || coalesce(cache_row.read_model #>> array['club_profiles',leg.from_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',leg.from_club_id,'canonical_name'], leg.from_club_id)
            || ' → ' || coalesce(cache_row.read_model #>> array['club_profiles',leg.to_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',leg.to_club_id,'canonical_name'], leg.to_club_id)
          when leg.leg_type = 'cash' then
            '£' || trim(to_char(leg.amount, 'FM999,999,999,990.00'))
            || ': ' || coalesce(cache_row.read_model #>> array['club_profiles',leg.from_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',leg.from_club_id,'canonical_name'], leg.from_club_id)
            || ' → ' || coalesce(cache_row.read_model #>> array['club_profiles',leg.to_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',leg.to_club_id,'canonical_name'], leg.to_club_id)
          else null
        end,
        E'\n' order by leg.sequence_no
      ) filter (where leg.leg_type in ('permanent_transfer','cash')) as summary_text
    from public.transfer_deal_legs leg
    where leg.revision_id = revision.id
  ) leg_summary
  where deal.world_id = p_world_id
    and deal.status = 'completed'
    and leg_summary.player_count > 0
  on conflict (world_id, source_key) where source_key is not null do nothing;
  get diagnostics row_count_value = row_count;
  inserted_count := inserted_count + row_count_value;

  if canonical_row.matchday is not null then
    insert into public.world_feed_items(
      world_id, item_type, title, body, source_key, metadata, created_at
    ) values (
      p_world_id,
      'matchday_upcoming',
      'Matchday ' || canonical_row.matchday::text || ' is coming up',
      case when canonical_row.next_turn_at is null then 'Teams should be submitted before the next turn.'
           else 'Next turn: ' || to_char(canonical_row.next_turn_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC.' end,
      'matchday_upcoming:' || current_season_id || ':' || canonical_row.matchday::text,
      jsonb_build_object('season_id', current_season_id, 'matchday', canonical_row.matchday, 'next_turn_at', canonical_row.next_turn_at),
      least(now(), coalesce(canonical_row.updated_at, now()))
    )
    on conflict (world_id, source_key) where source_key is not null do nothing;
    get diagnostics row_count_value = row_count;
    inserted_count := inserted_count + row_count_value;
  end if;

  -- Backfill every completed matchday present in compact runtime results/archive_results.
  -- This is intentionally set-based so feed sync can be skipped for several turns without losing history.
  with completed_matchdays as (
    select distinct
      coalesce(
        nullif(result.value #>> '{fixture,season_id}', ''),
        nullif(runtime.value->>'season_id', ''),
        current_season_id
      ) as season_id,
      case
        when coalesce(result.value #>> '{fixture,matchday}', '') ~ '^[0-9]+$'
          then (result.value #>> '{fixture,matchday}')::integer
        else null
      end as matchday
    from jsonb_each(coalesce(cache_row.read_model #> '{matchday_cycle,runtimes}', '{}'::jsonb)) runtime
    cross join lateral jsonb_array_elements(
      coalesce(runtime.value->'results', '[]'::jsonb)
      || coalesce(runtime.value->'archive_results', '[]'::jsonb)
    ) result
  )
  insert into public.world_feed_items(
    world_id, item_type, title, body, source_key, metadata, created_at
  )
  select
    p_world_id,
    'matchday_completed',
    'Matchday ' || completed.matchday::text || ' completed',
    'Results and updated standings are available in Competition.',
    'matchday_completed:' || completed.season_id || ':' || completed.matchday::text,
    jsonb_build_object('season_id', completed.season_id, 'matchday', completed.matchday),
    coalesce(canonical_row.updated_at, now())
  from completed_matchdays completed
  where completed.matchday is not null
    and not (completed.season_id = current_season_id and completed.matchday >= coalesce(canonical_row.matchday, 2147483647))
  on conflict (world_id, source_key) where source_key is not null do nothing;
  get diagnostics row_count_value = row_count;
  inserted_count := inserted_count + row_count_value;

  return inserted_count;
end;
$$;

revoke all on function public.sync_world_feed_system_items(text) from public, anon, authenticated;
grant execute on function public.sync_world_feed_system_items(text) to service_role;

commit;
