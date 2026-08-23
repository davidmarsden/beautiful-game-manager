-- #290 review follow-up: merge the original seasonless completed-matchday rows
-- with the later season-aware rows. The archived result projection does not retain
-- a trustworthy completion timestamp, so ordering of tied historical matchday
-- cards is handled explicitly by matchday number in the client rather than by
-- inventing dates.

begin;

create temporary table _world_feed_matchday_repair on commit drop as
with known_seasons as (
  select
    item.world_id,
    (item.metadata->>'matchday')::integer as matchday,
    min(public.world_feed_normalize_season_id(item.metadata->>'season_id')) as season_id
  from public.world_feed_items item
  where item.item_type = 'matchday_completed'
    and coalesce(item.metadata->>'matchday', '') ~ '^[0-9]+$'
    and nullif(trim(coalesce(item.metadata->>'season_id', '')), '') is not null
    and public.world_feed_normalize_season_id(item.metadata->>'season_id') <> 'season-unknown'
  group by item.world_id, (item.metadata->>'matchday')::integer
), candidates as (
  select
    item.id,
    item.world_id,
    case
      when nullif(trim(coalesce(item.metadata->>'season_id', '')), '') is null
        or public.world_feed_normalize_season_id(item.metadata->>'season_id') = 'season-unknown'
      then coalesce(
        known.season_id,
        public.world_feed_normalize_season_id(canonical.season_id),
        'season-' || coalesce(canonical.season_number, 1)::text
      )
      else public.world_feed_normalize_season_id(item.metadata->>'season_id')
    end as season_id,
    (item.metadata->>'matchday')::integer as matchday,
    item.created_at
  from public.world_feed_items item
  join public.canonical_world_saves canonical on canonical.world_id = item.world_id
  left join known_seasons known
    on known.world_id = item.world_id
   and known.matchday = (item.metadata->>'matchday')::integer
  where item.item_type = 'matchday_completed'
    and coalesce(item.metadata->>'matchday', '') ~ '^[0-9]+$'
), ranked as (
  select
    candidate.*,
    first_value(candidate.id) over (
      partition by candidate.world_id, candidate.season_id, candidate.matchday
      order by
        case when public.world_feed_normalize_season_id(coalesce(
          (select item.metadata->>'season_id' from public.world_feed_items item where item.id = candidate.id),
          'season-unknown'
        )) = 'season-unknown' then 1 else 0 end,
        candidate.created_at asc,
        candidate.id asc
    ) as winner_id
  from candidates candidate
)
select * from ranked;

update public.world_feed_comments comment
set feed_item_id = repair.winner_id
from _world_feed_matchday_repair repair
where comment.feed_item_id = repair.id
  and repair.id <> repair.winner_id;

delete from public.world_feed_items item
using _world_feed_matchday_repair repair
where item.id = repair.id
  and repair.id <> repair.winner_id;

with winners as (
  select distinct winner_id, season_id, matchday
  from _world_feed_matchday_repair
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

commit;
