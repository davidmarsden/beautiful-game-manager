-- #290 follow-up: one global matchday item, activity ordering, and admin pins.

begin;

alter table public.world_feed_items
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by_manager_id uuid references public.manager_profiles(id) on delete set null;

create or replace function public.world_feed_normalize_season_id(p_season_id text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select regexp_replace(
    coalesce(nullif(trim(p_season_id), ''), 'season-unknown'),
    ':d[0-9]+$',
    '',
    'i'
  );
$$;

revoke all on function public.world_feed_normalize_season_id(text) from public, anon, authenticated;
grant execute on function public.world_feed_normalize_season_id(text) to service_role;

-- Earlier backfill treated each division runtime season id (e.g. ...:d1) as a
-- separate season. Collapse those rows to one item per global season/matchday.
create temporary table _world_feed_matchday_merge on commit drop as
with candidates as (
  select
    item.id,
    item.world_id,
    public.world_feed_normalize_season_id(item.metadata->>'season_id') as season_id,
    (item.metadata->>'matchday')::integer as matchday,
    item.created_at
  from public.world_feed_items item
  where item.item_type = 'matchday_completed'
    and coalesce(item.metadata->>'matchday', '') ~ '^[0-9]+$'
), ranked as (
  select
    candidate.*,
    first_value(candidate.id) over (
      partition by candidate.world_id, candidate.season_id, candidate.matchday
      order by candidate.created_at asc, candidate.id asc
    ) as winner_id
  from candidates candidate
)
select * from ranked;

-- Preserve any discussion that happened on a duplicate before removing it.
update public.world_feed_comments comment
set feed_item_id = merge_row.winner_id
from _world_feed_matchday_merge merge_row
where comment.feed_item_id = merge_row.id
  and merge_row.id <> merge_row.winner_id;

delete from public.world_feed_items item
using _world_feed_matchday_merge merge_row
where item.id = merge_row.id
  and merge_row.id <> merge_row.winner_id;

with winners as (
  select distinct winner_id, world_id, season_id, matchday
  from _world_feed_matchday_merge
)
update public.world_feed_items item
set
  source_key = 'matchday_completed:' || winner.season_id || ':' || winner.matchday::text,
  metadata = jsonb_set(
    jsonb_set(coalesce(item.metadata, '{}'::jsonb), '{season_id}', to_jsonb(winner.season_id), true),
    '{matchday}',
    to_jsonb(winner.matchday),
    true
  )
from winners winner
where item.id = winner.winner_id;

-- Give repaired historical matchdays their actual completion time rather than
-- the timestamp at which the feed backfill happened.
with result_times as (
  select
    cache.world_id,
    public.world_feed_normalize_season_id(coalesce(
      nullif(result.value #>> '{fixture,season_id}', ''),
      canonical.season_id
    )) as season_id,
    (result.value #>> '{fixture,matchday}')::integer as matchday,
    max(nullif(result.value #>> '{commit,committed_at}', '')::timestamptz) as event_at
  from public.world_read_model_cache cache
  join public.canonical_world_saves canonical on canonical.world_id = cache.world_id
  cross join lateral jsonb_each(coalesce(cache.read_model #> '{matchday_cycle,runtimes}', '{}'::jsonb)) runtime
  cross join lateral jsonb_array_elements(
    coalesce(runtime.value->'results', '[]'::jsonb)
    || coalesce(runtime.value->'archive_results', '[]'::jsonb)
  ) result
  where coalesce(result.value #>> '{fixture,matchday}', '') ~ '^[0-9]+$'
  group by cache.world_id, season_id, matchday
)
update public.world_feed_items item
set created_at = result_time.event_at
from result_times result_time
where item.world_id = result_time.world_id
  and item.item_type = 'matchday_completed'
  and public.world_feed_normalize_season_id(item.metadata->>'season_id') = result_time.season_id
  and (item.metadata->>'matchday')::integer = result_time.matchday
  and result_time.event_at is not null;

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

  current_season_id := public.world_feed_normalize_season_id(coalesce(
    canonical_row.season_id,
    cache_row.read_model #>> '{matchday_cycle,season_id}',
    cache_row.read_model #>> '{squad_cycle,season_id}',
    'season-' || coalesce(canonical_row.season_number, 1)::text
  ));

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

  with completed_matchdays as (
    select
      public.world_feed_normalize_season_id(coalesce(
        nullif(result.value #>> '{fixture,season_id}', ''),
        current_season_id
      )) as season_id,
      (result.value #>> '{fixture,matchday}')::integer as matchday,
      max(nullif(result.value #>> '{commit,committed_at}', '')::timestamptz) as event_at
    from jsonb_each(coalesce(cache_row.read_model #> '{matchday_cycle,runtimes}', '{}'::jsonb)) runtime
    cross join lateral jsonb_array_elements(
      coalesce(runtime.value->'results', '[]'::jsonb)
      || coalesce(runtime.value->'archive_results', '[]'::jsonb)
    ) result
    where coalesce(result.value #>> '{fixture,matchday}', '') ~ '^[0-9]+$'
    group by season_id, matchday
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
    coalesce(completed.event_at, canonical_row.updated_at, now())
  from completed_matchdays completed
  on conflict (world_id, source_key) where source_key is not null do nothing;
  get diagnostics row_count_value = row_count;
  inserted_count := inserted_count + row_count_value;

  return inserted_count;
end;
$$;

create or replace function public.get_manager_world_feed_for_user(
  p_user_id uuid,
  p_world_id text,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  can_moderate_value boolean := false;
  result_value jsonb;
begin
  select profile.id, appointment.club_id, coalesce(profile.is_admin, false)
    into manager_id_value, club_id_value, can_moderate_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if manager_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  select coalesce(jsonb_agg(row_value order by is_pinned desc, pinned_at desc nulls last, activity_at desc, item_created_at desc, item_id desc), '[]'::jsonb)
  into result_value
  from (
    select
      item.created_at as item_created_at,
      item.id as item_id,
      item.pinned_at is not null as is_pinned,
      item.pinned_at,
      greatest(item.created_at, coalesce(comment_activity.latest_comment_at, item.created_at)) as activity_at,
      jsonb_build_object(
        'id', item.id,
        'item_type', item.item_type,
        'title', item.title,
        'body', item.body,
        'actor_manager_id', item.actor_manager_id,
        'actor_manager_name', actor.display_name,
        'actor_club_id', item.actor_club_id,
        'actor_club_name', coalesce(cache.read_model #>> array['club_profiles',item.actor_club_id,'club_name'], cache.read_model #>> array['club_profiles',item.actor_club_id,'canonical_name'], item.actor_club_id),
        'related_club_id', item.related_club_id,
        'related_deal_id', item.related_deal_id,
        'metadata', item.metadata,
        'created_at', item.created_at,
        'activity_at', greatest(item.created_at, coalesce(comment_activity.latest_comment_at, item.created_at)),
        'pinned_at', item.pinned_at,
        'comments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', comment.id,
            'manager_id', comment.manager_id,
            'manager_name', commenter.display_name,
            'club_id', comment.club_id,
            'club_name', coalesce(cache.read_model #>> array['club_profiles',comment.club_id,'club_name'], cache.read_model #>> array['club_profiles',comment.club_id,'canonical_name'], comment.club_id),
            'body', comment.body,
            'created_at', comment.created_at,
            'edited_at', comment.edited_at
          ) order by comment.created_at asc, comment.id asc)
          from public.world_feed_comments comment
          join public.manager_profiles commenter on commenter.id = comment.manager_id
          where comment.feed_item_id = item.id and comment.hidden_at is null
        ), '[]'::jsonb)
      ) as row_value
    from public.world_feed_items item
    left join public.manager_profiles actor on actor.id = item.actor_manager_id
    join public.world_read_model_cache cache on cache.world_id = item.world_id
    join public.canonical_world_saves canonical on canonical.world_id = item.world_id and canonical.save_checksum = cache.source_checksum
    left join lateral (
      select max(comment.created_at) as latest_comment_at
      from public.world_feed_comments comment
      where comment.feed_item_id = item.id and comment.hidden_at is null
    ) comment_activity on true
    where item.world_id = p_world_id and item.hidden_at is null
    order by is_pinned desc, item.pinned_at desc nulls last, activity_at desc, item.created_at desc, item.id desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) rows;

  return jsonb_build_object(
    'world_id', p_world_id,
    'club_id', club_id_value,
    'manager_id', manager_id_value,
    'can_moderate', can_moderate_value,
    'items', result_value
  );
end;
$$;

create or replace function public.set_world_feed_item_pinned_for_user(
  p_user_id uuid,
  p_world_id text,
  p_feed_item_id uuid,
  p_pinned boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  is_admin_value boolean := false;
  pinned_at_value timestamptz;
begin
  select profile.id, coalesce(profile.is_admin, false)
    into manager_id_value, is_admin_value
  from public.manager_profiles profile
  where profile.user_id = p_user_id
  limit 1;

  if manager_id_value is null or not is_admin_value then
    raise exception 'Administrator access required';
  end if;

  update public.world_feed_items
  set
    pinned_at = case when coalesce(p_pinned, false) then coalesce(pinned_at, now()) else null end,
    pinned_by_manager_id = case when coalesce(p_pinned, false) then manager_id_value else null end
  where id = p_feed_item_id
    and world_id = p_world_id
    and hidden_at is null
  returning pinned_at into pinned_at_value;

  if not found then raise exception 'Feed item not found'; end if;

  return jsonb_build_object(
    'id', p_feed_item_id,
    'pinned', pinned_at_value is not null,
    'pinned_at', pinned_at_value
  );
end;
$$;

revoke all on function public.sync_world_feed_system_items(text) from public, anon, authenticated;
revoke all on function public.get_manager_world_feed_for_user(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.set_world_feed_item_pinned_for_user(uuid,text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.sync_world_feed_system_items(text) to service_role;
grant execute on function public.get_manager_world_feed_for_user(uuid,text,integer) to service_role;
grant execute on function public.set_world_feed_item_pinned_for_user(uuid,text,uuid,boolean) to service_role;

commit;
