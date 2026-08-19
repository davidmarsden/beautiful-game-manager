-- #240: make split 25/25 ownership capacity an agreement-time invariant as well as a settlement-time invariant.

begin;

create or replace function public.guard_transfer_deal_split_squad_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  player_id_value text;
  target_club_id text;
  player_age integer := 99;
  target_cohort_count integer := 0;
  cache_model jsonb;
  cache_checksum text;
  canonical_checksum text;
  player_age_text text;
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

  player_age_text := cache_model #>> array['squad_cycle','players',player_id_value,'age'];
  if coalesce(player_age_text, '') ~ '^[0-9]+$' then player_age := player_age_text::integer; end if;

  select count(*)
    into target_cohort_count
  from jsonb_each(coalesce(cache_model #> '{squad_cycle,players}', '{}'::jsonb)) player(key,value)
  where coalesce(player.value->>'club_id', '') = target_club_id
    and case when player_age <= 21
      then coalesce(player.value->>'age', '') ~ '^[0-9]+$' and (player.value->>'age')::integer <= 21
      else not (coalesce(player.value->>'age', '') ~ '^[0-9]+$') or (player.value->>'age')::integer > 21
    end;

  if target_cohort_count >= 25 then
    if player_age <= 21 then
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

revoke all on function public.guard_transfer_deal_split_squad_capacity() from public, anon, authenticated;

commit;
