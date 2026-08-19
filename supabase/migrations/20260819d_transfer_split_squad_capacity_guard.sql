-- #240: make split 25/25 ownership capacity an agreement-time invariant as well as a settlement-time invariant.

begin;

create or replace function public.transfer_player_is_youth_for_capacity(p_player jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  age_text text;
begin
  if p_player is null or jsonb_typeof(p_player) <> 'object' then return false; end if;

  if jsonb_typeof(p_player -> 'youth_eligible_at_season_start') = 'boolean' then
    return (p_player ->> 'youth_eligible_at_season_start')::boolean;
  end if;

  age_text := p_player ->> 'season_start_age';
  if coalesce(age_text, '') ~ '^[0-9]+$' then return age_text::integer <= 21; end if;

  age_text := p_player ->> 'age';
  if coalesce(age_text, '') ~ '^[0-9]+$' then return age_text::integer <= 21; end if;

  return false;
end;
$$;

create or replace function public.guard_transfer_deal_split_squad_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  player_id_value text;
  target_club_id text;
  player_value jsonb;
  cohort_name text;
  target_cohort_count integer := 0;
  reserved_inbound_count integer := 0;
  cache_model jsonb;
  cache_checksum text;
  canonical_checksum text;
  capacity_lock_key bigint;
begin
  if new.status <> 'agreed' or not (
    old.status is distinct from 'agreed'
    or old.current_revision_no is distinct from new.current_revision_no
  ) then
    return new;
  end if;

  select leg.player_id, leg.to_club_id
    into player_id_value, target_club_id
  from public.transfer_deal_revisions revision
  join public.transfer_deal_legs leg
    on leg.revision_id = revision.id
   and leg.leg_type = 'permanent_transfer'
  where revision.deal_id = new.id
    and revision.revision_no = new.current_revision_no
  order by leg.sequence_no asc
  limit 1;

  if player_id_value is null or target_club_id is null then
    raise exception 'Agreed transfer revision does not contain a permanent player leg';
  end if;

  select read_model, source_checksum
    into cache_model, cache_checksum
  from public.world_read_model_cache
  where world_id = new.world_id
  limit 1;
  select save_checksum into canonical_checksum
  from public.canonical_world_saves
  where world_id = new.world_id
  limit 1;

  if cache_model is null or cache_checksum is null or canonical_checksum is null or cache_checksum <> canonical_checksum then
    raise exception 'World read model is refreshing; transfer agreement cannot be validated yet';
  end if;

  player_value := cache_model #> array['squad_cycle','players',player_id_value];
  cohort_name := case when public.transfer_player_is_youth_for_capacity(player_value) then 'youth' else 'first_team' end;

  -- Serialize agreements competing for the same club/cohort slot. This means a
  -- second concurrent agreement sees the first committed reservation instead of
  -- allowing both deals to bind against the same 25th place.
  capacity_lock_key := pg_catalog.hashtextextended(
    concat_ws('|', 'transfer-squad-capacity', new.world_id, target_club_id, cohort_name), 0
  );
  perform pg_catalog.pg_advisory_xact_lock(capacity_lock_key);

  select count(*)
    into target_cohort_count
  from jsonb_each(coalesce(cache_model #> '{squad_cycle,players}', '{}'::jsonb)) player(key,value)
  where coalesce(player.value->>'club_id', '') = target_club_id
    and public.transfer_player_is_youth_for_capacity(player.value) = (cohort_name = 'youth');

  -- Agreed inbound transfers have reserved a place even though the canonical
  -- world/read model will not reflect their new ownership until settlement.
  select count(*)
    into reserved_inbound_count
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
    and other_leg.to_club_id = target_club_id
    and public.transfer_player_is_youth_for_capacity(
      cache_model #> array['squad_cycle','players',other_leg.player_id]
    ) = (cohort_name = 'youth');

  if target_cohort_count + reserved_inbound_count >= 25 then
    if cohort_name = 'youth' then
      raise exception '% youth squad limit reached (25)', target_club_id;
    else
      raise exception '% first-team squad limit reached (25)', target_club_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists transfer_deal_split_squad_capacity_guard on public.transfer_deals;
create trigger transfer_deal_split_squad_capacity_guard
before update of status, current_revision_no on public.transfer_deals
for each row execute function public.guard_transfer_deal_split_squad_capacity();

revoke all on function public.transfer_player_is_youth_for_capacity(jsonb) from public, anon, authenticated;
revoke all on function public.guard_transfer_deal_split_squad_capacity() from public, anon, authenticated;

commit;
