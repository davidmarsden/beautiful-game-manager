-- #290 follow-up: turn matchday feed cards into deliberate per-division social threads.

begin;

alter table public.world_feed_items
  drop constraint if exists world_feed_items_item_type_check;

alter table public.world_feed_items
  add constraint world_feed_items_item_type_check
  check (item_type = any (array[
    'manager_post'::text,
    'manager_appointment'::text,
    'transfer_completed'::text,
    'matchday_upcoming'::text,
    'matchday_completed'::text,
    'matchday_press_conference'::text
  ]));

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

  select * into canonical_row
  from public.canonical_world_saves
  where world_id = p_world_id
  limit 1;

  select * into cache_row
  from public.world_read_model_cache
  where world_id = p_world_id
  limit 1;

  if canonical_row.world_id is null
     or cache_row.read_model is null
     or cache_row.source_checksum <> canonical_row.save_checksum then
    raise exception 'World read model is refreshing; please retry shortly';
  end if;

  current_season_id := public.world_feed_normalize_season_id(coalesce(
    canonical_row.season_id,
    cache_row.read_model #>> '{matchday_cycle,season_id}',
    cache_row.read_model #>> '{squad_cycle,season_id}',
    'season-' || coalesce(canonical_row.season_number, 1)::text
  ));

  -- Appointments remain ordinary world events.
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

  -- Completed transfers remain authoritative-leg summaries.
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

  -- One live pre-match press-conference thread per division. Fixtures are taken
  -- from the actual runtime schedule; discussion remains ordinary feed state.
  if canonical_row.matchday is not null then
    with runtime_rows as (
      select
        runtime.key as division_key,
        nullif(regexp_replace(runtime.key, '[^0-9]', '', 'g'), '')::integer as division_number,
        runtime.value as runtime_value
      from jsonb_each(coalesce(cache_row.read_model #> '{matchday_cycle,runtimes}', '{}'::jsonb)) runtime
    ), fixture_rows as (
      select
        runtime.division_key,
        runtime.division_number,
        public.world_feed_normalize_season_id(coalesce(
          nullif(fixture.value->>'season_id', ''), current_season_id
        )) as season_id,
        (fixture.value->>'matchday')::integer as matchday,
        fixture.value->>'fixture_id' as fixture_id,
        nullif(fixture.value->>'kickoff_at', '')::timestamptz as kickoff_at,
        fixture.value->>'home_club_id' as home_club_id,
        fixture.value->>'away_club_id' as away_club_id
      from runtime_rows runtime
      cross join lateral jsonb_array_elements(coalesce(runtime.runtime_value->'fixtures', '[]'::jsonb)) fixture
      where coalesce(fixture.value->>'matchday', '') ~ '^[0-9]+$'
        and (fixture.value->>'matchday')::integer = canonical_row.matchday
    ), division_threads as (
      select
        division_key,
        division_number,
        season_id,
        matchday,
        min(kickoff_at) as kickoff_at,
        array_agg(distinct club_id) filter (where club_id is not null) as club_ids,
        string_agg(
          coalesce(cache_row.read_model #>> array['club_profiles',home_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',home_club_id,'canonical_name'], home_club_id)
          || ' v ' ||
          coalesce(cache_row.read_model #>> array['club_profiles',away_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',away_club_id,'canonical_name'], away_club_id),
          E'\n' order by fixture_id
        ) as fixture_text
      from fixture_rows
      cross join lateral unnest(array[home_club_id, away_club_id]) club_id
      group by division_key, division_number, season_id, matchday
    )
    insert into public.world_feed_items(
      world_id, item_type, title, body, source_key, metadata, created_at
    )
    select
      p_world_id,
      'matchday_press_conference',
      'Division ' || coalesce(thread.division_number::text, upper(thread.division_key))
        || ' — Matchday ' || thread.matchday::text || ' press conference',
      thread.fixture_text || E'\n\nPredictions, team news, selection headaches, mind games?',
      'matchday_press:' || thread.season_id || ':' || thread.division_key || ':' || thread.matchday::text,
      jsonb_build_object(
        'season_id', thread.season_id,
        'division_key', thread.division_key,
        'division_number', thread.division_number,
        'matchday', thread.matchday,
        'kickoff_at', thread.kickoff_at,
        'club_ids', to_jsonb(thread.club_ids),
        'thread_scope', 'division'
      ),
      now()
    from division_threads thread
    on conflict (world_id, source_key) where source_key is not null
    do update set
      title = excluded.title,
      body = excluded.body,
      metadata = excluded.metadata;
    get diagnostics row_count_value = row_count;
    inserted_count := inserted_count + row_count_value;
  end if;

  -- One post-match reaction thread per division and completed matchday. Runtime
  -- results and archive_results overlap, so deduplicate by fixture_id first.
  with runtime_rows as (
    select
      runtime.key as division_key,
      nullif(regexp_replace(runtime.key, '[^0-9]', '', 'g'), '')::integer as division_number,
      runtime.value as runtime_value
    from jsonb_each(coalesce(cache_row.read_model #> '{matchday_cycle,runtimes}', '{}'::jsonb)) runtime
  ), raw_results as (
    select
      runtime.division_key,
      runtime.division_number,
      result.value
    from runtime_rows runtime
    cross join lateral jsonb_array_elements(
      coalesce(runtime.runtime_value->'results', '[]'::jsonb)
      || coalesce(runtime.runtime_value->'archive_results', '[]'::jsonb)
    ) result
    where coalesce(result.value #>> '{fixture,matchday}', '') ~ '^[0-9]+$'
  ), result_rows as (
    select distinct on (division_key, value #>> '{fixture,fixture_id}')
      division_key,
      division_number,
      public.world_feed_normalize_season_id(coalesce(
        nullif(value #>> '{fixture,season_id}', ''), current_season_id
      )) as season_id,
      (value #>> '{fixture,matchday}')::integer as matchday,
      value #>> '{fixture,fixture_id}' as fixture_id,
      nullif(value #>> '{fixture,kickoff_at}', '')::timestamptz as kickoff_at,
      value #>> '{fixture,home_club_id}' as home_club_id,
      value #>> '{fixture,away_club_id}' as away_club_id,
      coalesce((value #>> '{score,home}')::integer, 0) as home_score,
      coalesce((value #>> '{score,away}')::integer, 0) as away_score
    from raw_results
    order by division_key, value #>> '{fixture,fixture_id}'
  ), division_results as (
    select
      result.division_key,
      result.division_number,
      result.season_id,
      result.matchday,
      max(result.kickoff_at) as event_at,
      array_agg(distinct club_id) filter (where club_id is not null) as club_ids,
      string_agg(
        coalesce(cache_row.read_model #>> array['club_profiles',result.home_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',result.home_club_id,'canonical_name'], result.home_club_id)
        || ' ' || result.home_score::text || '–' || result.away_score::text || ' '
        || coalesce(cache_row.read_model #>> array['club_profiles',result.away_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',result.away_club_id,'canonical_name'], result.away_club_id),
        E'\n' order by result.fixture_id
      ) as result_text
    from result_rows result
    cross join lateral unnest(array[result.home_club_id, result.away_club_id]) club_id
    group by result.division_key, result.division_number, result.season_id, result.matchday
  )
  insert into public.world_feed_items(
    world_id, item_type, title, body, source_key, metadata, created_at
  )
  select
    p_world_id,
    'matchday_completed',
    'Division ' || coalesce(thread.division_number::text, upper(thread.division_key))
      || ' — Matchday ' || thread.matchday::text || ' completed',
    thread.result_text || E'\n\nManagers: post your reaction below.',
    'matchday_completed:' || thread.season_id || ':' || thread.division_key || ':' || thread.matchday::text,
    jsonb_build_object(
      'season_id', thread.season_id,
      'division_key', thread.division_key,
      'division_number', thread.division_number,
      'matchday', thread.matchday,
      'club_ids', to_jsonb(thread.club_ids),
      'thread_scope', 'division'
    ),
    coalesce(thread.event_at, canonical_row.updated_at, now())
  from division_results thread
  on conflict (world_id, source_key) where source_key is not null
  do update set
    title = excluded.title,
    body = excluded.body,
    metadata = excluded.metadata;
  get diagnostics row_count_value = row_count;
  inserted_count := inserted_count + row_count_value;

  return inserted_count;
end;
$$;

revoke all on function public.sync_world_feed_system_items(text) from public, anon, authenticated;
grant execute on function public.sync_world_feed_system_items(text) to service_role;

-- Build the new division threads before retiring the generic matchday cards.
do $$
declare
  world_row record;
begin
  for world_row in select world_id from public.canonical_world_saves loop
    perform public.sync_world_feed_system_items(world_row.world_id);
  end loop;
end;
$$;

-- Preserve existing discussion by moving comments to the thread for the
-- commenter's club. If no club match is possible, retain it on the first
-- division thread for that matchday rather than throwing conversation away.
with moves as (
  select
    comment.id as comment_id,
    coalesce(matched.id, fallback.id) as target_id
  from public.world_feed_comments comment
  join public.world_feed_items old_item on old_item.id = comment.feed_item_id
  left join lateral (
    select target.id
    from public.world_feed_items target
    where target.world_id = old_item.world_id
      and target.item_type = 'matchday_completed'
      and target.metadata->>'thread_scope' = 'division'
      and target.metadata->>'matchday' = old_item.metadata->>'matchday'
      and coalesce(target.metadata->'club_ids', '[]'::jsonb) ? comment.club_id
    order by (target.metadata->>'division_number')::integer nulls last, target.id
    limit 1
  ) matched on true
  left join lateral (
    select target.id
    from public.world_feed_items target
    where target.world_id = old_item.world_id
      and target.item_type = 'matchday_completed'
      and target.metadata->>'thread_scope' = 'division'
      and target.metadata->>'matchday' = old_item.metadata->>'matchday'
    order by (target.metadata->>'division_number')::integer nulls last, target.id
    limit 1
  ) fallback on true
  where old_item.item_type = 'matchday_completed'
    and coalesce(old_item.metadata->>'thread_scope', '') <> 'division'
)
update public.world_feed_comments comment
set feed_item_id = moves.target_id
from moves
where comment.id = moves.comment_id
  and moves.target_id is not null;

with moves as (
  select
    comment.id as comment_id,
    coalesce(matched.id, fallback.id) as target_id
  from public.world_feed_comments comment
  join public.world_feed_items old_item on old_item.id = comment.feed_item_id
  left join lateral (
    select target.id
    from public.world_feed_items target
    where target.world_id = old_item.world_id
      and target.item_type = 'matchday_press_conference'
      and target.metadata->>'thread_scope' = 'division'
      and target.metadata->>'matchday' = old_item.metadata->>'matchday'
      and coalesce(target.metadata->'club_ids', '[]'::jsonb) ? comment.club_id
    order by (target.metadata->>'division_number')::integer nulls last, target.id
    limit 1
  ) matched on true
  left join lateral (
    select target.id
    from public.world_feed_items target
    where target.world_id = old_item.world_id
      and target.item_type = 'matchday_press_conference'
      and target.metadata->>'thread_scope' = 'division'
      and target.metadata->>'matchday' = old_item.metadata->>'matchday'
    order by (target.metadata->>'division_number')::integer nulls last, target.id
    limit 1
  ) fallback on true
  where old_item.item_type = 'matchday_upcoming'
)
update public.world_feed_comments comment
set feed_item_id = moves.target_id
from moves
where comment.id = moves.comment_id
  and moves.target_id is not null;

update public.world_feed_items
set hidden_at = coalesce(hidden_at, now())
where item_type = 'matchday_completed'
  and coalesce(metadata->>'thread_scope', '') <> 'division';

update public.world_feed_items
set hidden_at = coalesce(hidden_at, now())
where item_type = 'matchday_upcoming';

commit;
