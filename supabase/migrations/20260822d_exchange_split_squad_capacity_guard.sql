-- #272 follow-up: make agreement-time split-squad capacity validation use the complete
-- current revision's final net player movement, matching atomic settlement semantics.
--
-- The earlier guard inspected only the first permanent-transfer leg and counted only
-- reserved inbound players. That could reject a valid 25↔25 exchange before the atomic
-- settlement worker ever ran. This replacement evaluates every affected club/cohort as:
--
--   canonical ownership + other agreed net reservations + this deal net movement <= 25
--
-- All calculations use the same fresh read-model/canonical checksum pair.

begin;

create or replace function public.guard_transfer_deal_split_squad_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cache_model jsonb;
  cache_checksum text;
  canonical_checksum text;
  affected record;
  canonical_count integer;
  other_net integer;
  this_net integer;
  final_count integer;
  capacity_lock_key bigint;
begin
  if new.status <> 'agreed' or not (
    old.status is distinct from 'agreed'
    or old.current_revision_no is distinct from new.current_revision_no
  ) then
    return new;
  end if;

  if not exists (
    select 1
    from public.transfer_deal_revisions revision
    join public.transfer_deal_legs leg
      on leg.revision_id = revision.id
     and leg.leg_type = 'permanent_transfer'
    where revision.deal_id = new.id
      and revision.revision_no = new.current_revision_no
  ) then
    raise exception 'Agreed transfer revision does not contain a permanent player leg';
  end if;

  select read_model, source_checksum
    into cache_model, cache_checksum
  from public.world_read_model_cache
  where world_id = new.world_id
  limit 1;

  select save_checksum
    into canonical_checksum
  from public.canonical_world_saves
  where world_id = new.world_id
  limit 1;

  if cache_model is null
     or cache_checksum is null
     or canonical_checksum is null
     or cache_checksum <> canonical_checksum then
    raise exception 'World read model is refreshing; transfer agreement cannot be validated yet';
  end if;

  -- Evaluate every club/cohort touched by the complete current revision. The cohort is
  -- derived from the canonical player record, so inbound and outbound legs are classified
  -- consistently with the existing split-squad rule.
  for affected in
    with current_legs as (
      select leg.player_id, leg.from_club_id, leg.to_club_id
      from public.transfer_deal_revisions revision
      join public.transfer_deal_legs leg
        on leg.revision_id = revision.id
       and leg.leg_type = 'permanent_transfer'
      where revision.deal_id = new.id
        and revision.revision_no = new.current_revision_no
    ), affected_pairs as (
      select from_club_id as club_id,
             case when public.transfer_player_is_youth_for_capacity(
               cache_model #> array['squad_cycle','players',player_id]
             ) then 'youth' else 'first_team' end as cohort_name
      from current_legs
      union
      select to_club_id as club_id,
             case when public.transfer_player_is_youth_for_capacity(
               cache_model #> array['squad_cycle','players',player_id]
             ) then 'youth' else 'first_team' end as cohort_name
      from current_legs
    )
    select club_id, cohort_name
    from affected_pairs
    order by club_id, cohort_name
  loop
    -- Serialize all agreements competing for this final club/cohort capacity. Taking
    -- locks in deterministic club/cohort order avoids deadlocks for two-club exchanges.
    capacity_lock_key := pg_catalog.hashtextextended(
      concat_ws('|', 'transfer-squad-capacity', new.world_id, affected.club_id, affected.cohort_name), 0
    );
    perform pg_catalog.pg_advisory_xact_lock(capacity_lock_key);

    select count(*)
      into canonical_count
    from jsonb_each(coalesce(cache_model #> '{squad_cycle,players}', '{}'::jsonb)) player(key,value)
    where coalesce(player.value->>'club_id', '') = affected.club_id
      and public.transfer_player_is_youth_for_capacity(player.value) = (affected.cohort_name = 'youth');

    -- Other agreed deals reserve their *net* final movement for this club/cohort.
    -- This retains concurrency safety without treating only inbound legs as reservations.
    select coalesce(sum(
      case
        when other_leg.to_club_id = affected.club_id then 1
        when other_leg.from_club_id = affected.club_id then -1
        else 0
      end
    ), 0)::integer
      into other_net
    from public.transfer_deals other_deal
    join public.transfer_deal_revisions other_revision
      on other_revision.deal_id = other_deal.id
     and other_revision.revision_no = other_deal.current_revision_no
    join public.transfer_deal_legs other_leg
      on other_leg.revision_id = other_revision.id
     and other_leg.leg_type = 'permanent_transfer'
    where other_deal.world_id = new.world_id
      and other_deal.id <> new.id
      and other_deal.status = 'agreed'
      and (other_leg.from_club_id = affected.club_id or other_leg.to_club_id = affected.club_id)
      and public.transfer_player_is_youth_for_capacity(
        cache_model #> array['squad_cycle','players',other_leg.player_id]
      ) = (affected.cohort_name = 'youth');

    -- Apply this complete revision as one simultaneous movement, rather than inspecting
    -- one arbitrary player leg.
    select coalesce(sum(
      case
        when leg.to_club_id = affected.club_id then 1
        when leg.from_club_id = affected.club_id then -1
        else 0
      end
    ), 0)::integer
      into this_net
    from public.transfer_deal_revisions revision
    join public.transfer_deal_legs leg
      on leg.revision_id = revision.id
     and leg.leg_type = 'permanent_transfer'
    where revision.deal_id = new.id
      and revision.revision_no = new.current_revision_no
      and (leg.from_club_id = affected.club_id or leg.to_club_id = affected.club_id)
      and public.transfer_player_is_youth_for_capacity(
        cache_model #> array['squad_cycle','players',leg.player_id]
      ) = (affected.cohort_name = 'youth');

    final_count := canonical_count + other_net + this_net;

    if final_count > 25 then
      if affected.cohort_name = 'youth' then
        raise exception '% youth squad limit reached (25)', affected.club_id;
      else
        raise exception '% first-team squad limit reached (25)', affected.club_id;
      end if;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.guard_transfer_deal_split_squad_capacity() from public, anon, authenticated;

commit;
