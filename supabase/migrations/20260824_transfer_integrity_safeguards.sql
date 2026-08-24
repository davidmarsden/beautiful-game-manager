-- #321: transparent transfer-integrity safeguards and official in-game binding.
--
-- Alpha policy:
--   * at most three reserved/completed transfer packages per unordered club pair per season;
--   * multi-player revisions count as one package;
--   * normal bad judgement remains legal;
--   * unusual core-player concentration receives a published 24-hour cooling period;
--   * the board refuses only the narrow extreme of three or more of a club's
--     current top-five rated players leaving in one revision with no player returning;
--   * only the TBG transfer lifecycle can create a binding obligation.

begin;

alter table public.transfer_deals
  add column if not exists integrity_season_id text,
  add column if not exists integrity_pair_club_a text,
  add column if not exists integrity_pair_club_b text,
  add column if not exists integrity_level text not null default 'normal',
  add column if not exists integrity_reasons jsonb not null default '[]'::jsonb,
  add column if not exists integrity_assessment jsonb not null default '{}'::jsonb,
  add column if not exists integrity_cooling_minutes integer not null default 15,
  add column if not exists binding_authority text not null default 'tbg_transfer_mechanism_only';

alter table public.transfer_deals
  drop constraint if exists transfer_deals_integrity_level_check,
  add constraint transfer_deals_integrity_level_check
    check (integrity_level in ('normal', 'warning')),
  drop constraint if exists transfer_deals_integrity_cooling_check,
  add constraint transfer_deals_integrity_cooling_check
    check (integrity_cooling_minutes between 15 and 1440),
  drop constraint if exists transfer_deals_binding_authority_check,
  add constraint transfer_deals_binding_authority_check
    check (binding_authority = 'tbg_transfer_mechanism_only'),
  drop constraint if exists transfer_deals_integrity_pair_order_check,
  add constraint transfer_deals_integrity_pair_order_check
    check (
      (integrity_pair_club_a is null and integrity_pair_club_b is null)
      or integrity_pair_club_a < integrity_pair_club_b
    );

comment on column public.transfer_deals.binding_authority is
  'Only the official TBG in-game transfer mechanism can create a binding transfer obligation. External promises are non-binding.';
comment on column public.transfer_deals.integrity_assessment is
  'Publicly explainable package-level stewardship assessment captured when the current revision becomes agreed.';

-- The pre-alpha world has one active season. Backfill existing first-class deals
-- so already completed/reserved test deals count consistently against the pair cap.
with pair_values as (
  select deal.id,
         min(participant.club_id) as club_a,
         max(participant.club_id) as club_b,
         count(distinct participant.club_id) as club_count,
         save.season_id
  from public.transfer_deals deal
  join public.transfer_deal_participants participant on participant.deal_id = deal.id
  join public.canonical_world_saves save on save.world_id = deal.world_id
  group by deal.id, save.season_id
)
update public.transfer_deals deal
set integrity_season_id = pair_values.season_id,
    integrity_pair_club_a = pair_values.club_a,
    integrity_pair_club_b = pair_values.club_b
from pair_values
where deal.id = pair_values.id
  and pair_values.club_count = 2
  and deal.integrity_season_id is null;

create index if not exists transfer_deals_integrity_pair_season_idx
  on public.transfer_deals(world_id, integrity_season_id, integrity_pair_club_a, integrity_pair_club_b, status);

create or replace function public.guard_transfer_deal_integrity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  participant_count integer;
  pair_a text;
  pair_b text;
  season_value text;
  canonical_checksum text;
  cache_row public.world_read_model_cache;
  pair_reserved_count integer;
  pair_lock_key bigint;
  outgoing_a integer := 0;
  outgoing_b integer := 0;
  incoming_a integer := 0;
  incoming_b integer := 0;
  top5_outgoing_a integer := 0;
  top5_outgoing_b integer := 0;
  reasons_value jsonb := '[]'::jsonb;
  warning_value boolean := false;
begin
  -- Only assess the exact revision at the point it acquires official in-game
  -- agreement. Re-assess if an agreed revision itself changes.
  if new.status <> 'agreed' or (
    old.status = 'agreed'
    and old.current_revision_no is not distinct from new.current_revision_no
  ) then
    return new;
  end if;

  select count(distinct participant.club_id),
         min(participant.club_id),
         max(participant.club_id)
    into participant_count, pair_a, pair_b
  from public.transfer_deal_participants participant
  where participant.deal_id = new.id;

  if participant_count <> 2 or pair_a is null or pair_b is null or pair_a = pair_b then
    raise exception 'Current alpha transfer-integrity rules require exactly two distinct participant clubs';
  end if;

  select save.season_id, save.save_checksum
    into season_value, canonical_checksum
  from public.canonical_world_saves save
  where save.world_id = new.world_id
  limit 1;
  if season_value is null or canonical_checksum is null then
    raise exception 'Canonical season state is unavailable; transfer agreement cannot be verified';
  end if;

  -- Serialize all agreements for the same unordered club pair and season. This
  -- prevents two concurrent offers from both claiming the final (third) slot.
  pair_lock_key := pg_catalog.hashtextextended(
    concat_ws('|', 'transfer-integrity', new.world_id, season_value, pair_a, pair_b), 0
  );
  perform pg_catalog.pg_advisory_xact_lock(pair_lock_key);

  select count(*) into pair_reserved_count
  from public.transfer_deals deal
  where deal.id <> new.id
    and deal.world_id = new.world_id
    and deal.integrity_season_id = season_value
    and deal.integrity_pair_club_a = pair_a
    and deal.integrity_pair_club_b = pair_b
    and deal.status in ('agreed', 'completed');

  if pair_reserved_count >= 3 then
    raise exception 'Seasonal transfer limit reached: these clubs already have three binding/completed transfer packages this season';
  end if;

  select * into cache_row
  from public.world_read_model_cache cache
  where cache.world_id = new.world_id
  limit 1;
  if cache_row.read_model is null or cache_row.source_checksum <> canonical_checksum then
    raise exception 'World read model is refreshing; transfer integrity cannot be assessed yet';
  end if;

  with current_legs as (
    select leg.from_club_id, leg.to_club_id, leg.player_id
    from public.transfer_deal_revisions revision
    join public.transfer_deal_legs leg on leg.revision_id = revision.id
    where revision.deal_id = new.id
      and revision.revision_no = new.current_revision_no
      and leg.leg_type = 'permanent_transfer'
  ), ranked_players as (
    select player.key as player_id,
           player.value->>'club_id' as club_id,
           coalesce(
             case when coalesce(player.value->>'rating', '') ~ '^[0-9]+([.][0-9]+)?$'
               then (player.value->>'rating')::numeric end,
             case when coalesce(player.value->>'underlying_ability_rating', '') ~ '^[0-9]+([.][0-9]+)?$'
               then (player.value->>'underlying_ability_rating')::numeric end,
             0
           ) as rating,
           row_number() over (
             partition by player.value->>'club_id'
             order by coalesce(
               case when coalesce(player.value->>'rating', '') ~ '^[0-9]+([.][0-9]+)?$'
                 then (player.value->>'rating')::numeric end,
               case when coalesce(player.value->>'underlying_ability_rating', '') ~ '^[0-9]+([.][0-9]+)?$'
                 then (player.value->>'underlying_ability_rating')::numeric end,
               0
             ) desc, player.key asc
           ) as club_rank
    from jsonb_each(cache_row.read_model #> '{squad_cycle,players}') player
    where player.value->>'club_id' in (pair_a, pair_b)
  )
  select
    count(*) filter (where leg.from_club_id = pair_a),
    count(*) filter (where leg.from_club_id = pair_b),
    count(*) filter (where leg.to_club_id = pair_a),
    count(*) filter (where leg.to_club_id = pair_b),
    count(*) filter (where leg.from_club_id = pair_a and ranked.club_rank <= 5),
    count(*) filter (where leg.from_club_id = pair_b and ranked.club_rank <= 5)
  into outgoing_a, outgoing_b, incoming_a, incoming_b, top5_outgoing_a, top5_outgoing_b
  from current_legs leg
  left join ranked_players ranked
    on ranked.player_id = leg.player_id and ranked.club_id = leg.from_club_id;

  -- The board does not second-guess prices or ordinary football judgement. It
  -- refuses only a narrow, objective club-stripping pattern.
  if top5_outgoing_a >= 3 and incoming_a = 0 then
    raise exception 'Board refusal: this package would send three or more of % current five highest-rated players without any player returning', pair_a;
  end if;
  if top5_outgoing_b >= 3 and incoming_b = 0 then
    raise exception 'Board refusal: this package would send three or more of % current five highest-rated players without any player returning', pair_b;
  end if;

  if top5_outgoing_a >= 2 then
    warning_value := true;
    reasons_value := reasons_value || jsonb_build_array(jsonb_build_object(
      'code', 'multiple_core_players_outgoing', 'club_id', pair_a,
      'detail', 'Two or more of the club current five highest-rated players leave in this package.'
    ));
  end if;
  if top5_outgoing_b >= 2 then
    warning_value := true;
    reasons_value := reasons_value || jsonb_build_array(jsonb_build_object(
      'code', 'multiple_core_players_outgoing', 'club_id', pair_b,
      'detail', 'Two or more of the club current five highest-rated players leave in this package.'
    ));
  end if;
  if outgoing_a >= 4 and incoming_a = 0 then
    warning_value := true;
    reasons_value := reasons_value || jsonb_build_array(jsonb_build_object(
      'code', 'large_one_way_player_package', 'club_id', pair_a,
      'detail', 'Four or more players leave this club in one package with no player returning.'
    ));
  end if;
  if outgoing_b >= 4 and incoming_b = 0 then
    warning_value := true;
    reasons_value := reasons_value || jsonb_build_array(jsonb_build_object(
      'code', 'large_one_way_player_package', 'club_id', pair_b,
      'detail', 'Four or more players leave this club in one package with no player returning.'
    ));
  end if;

  new.integrity_season_id := season_value;
  new.integrity_pair_club_a := pair_a;
  new.integrity_pair_club_b := pair_b;
  new.integrity_level := case when warning_value then 'warning' else 'normal' end;
  new.integrity_reasons := reasons_value;
  new.integrity_cooling_minutes := case when warning_value then 1440 else 15 end;
  new.binding_authority := 'tbg_transfer_mechanism_only';
  new.integrity_assessment := jsonb_build_object(
    'version', 'tbg-transfer-integrity-v1',
    'season_id', season_value,
    'pair', jsonb_build_array(pair_a, pair_b),
    'pair_packages_already_reserved_or_completed', pair_reserved_count,
    'pair_package_number_if_completed', pair_reserved_count + 1,
    'club_a', jsonb_build_object(
      'club_id', pair_a, 'players_outgoing', outgoing_a, 'players_incoming', incoming_a,
      'top_five_players_outgoing', top5_outgoing_a
    ),
    'club_b', jsonb_build_object(
      'club_id', pair_b, 'players_outgoing', outgoing_b, 'players_incoming', incoming_b,
      'top_five_players_outgoing', top5_outgoing_b
    ),
    'level', case when warning_value then 'warning' else 'normal' end,
    'cooling_minutes', case when warning_value then 1440 else 15 end,
    'binding_authority', 'tbg_transfer_mechanism_only',
    'external_agreements_binding', false
  );

  return new;
end;
$$;

drop trigger if exists transfer_deal_integrity_guard on public.transfer_deals;
create trigger transfer_deal_integrity_guard
before update of status, current_revision_no on public.transfer_deals
for each row execute function public.guard_transfer_deal_integrity();

-- PostgreSQL fires same-timing triggers in name order. `transfer_deal_integrity_guard`
-- therefore runs before `transfer_deal_lifecycle_schedule`, allowing the lifecycle
-- to use the integrity cooling period selected above.
create or replace function public.schedule_transfer_deal_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  anchor_at timestamptz;
  cooling_interval interval;
begin
  if new.status = 'agreed' and (
    old.status is distinct from 'agreed'
    or old.current_revision_no is distinct from new.current_revision_no
    or new.grace_expires_at is null
    or new.settle_at is null
  ) then
    anchor_at := coalesce(new.updated_at, now());
    cooling_interval := make_interval(mins => greatest(15, least(coalesce(new.integrity_cooling_minutes, 15), 1440)));
    new.grace_expires_at := anchor_at + cooling_interval;
    new.binding_at := anchor_at + cooling_interval;
    -- Keep the existing normal three-hour settlement delay. A warning extends the
    -- settlement deadline by exactly the additional cooling time.
    new.settle_at := anchor_at + cooling_interval + interval '2 hours 45 minutes';
    new.settlement_previous_checksum := null;
    new.settlement_replacement_checksum := null;
    new.settlement_error := null;
    new.settlement_attempts := 0;
  end if;
  return new;
end;
$$;

create or replace function public.get_manager_transfer_lifecycle_for_user(
  p_user_id uuid,
  p_world_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  club_id_value text;
  result_value jsonb;
begin
  select appointment.club_id
    into club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;

  if club_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', deal.id,
    'status', deal.status,
    'effective_state', case
      when deal.status <> 'agreed' then deal.status
      when now() < coalesce(deal.grace_expires_at, '-infinity'::timestamptz) then 'grace_period'
      else 'binding'
    end,
    'grace_expires_at', deal.grace_expires_at,
    'binding_at', deal.binding_at,
    'settle_at', deal.settle_at,
    'can_cancel_in_grace', deal.status = 'agreed' and now() < coalesce(deal.grace_expires_at, '-infinity'::timestamptz),
    'settlement_error', deal.settlement_error,
    'integrity_level', deal.integrity_level,
    'integrity_reasons', deal.integrity_reasons,
    'integrity_assessment', deal.integrity_assessment,
    'integrity_cooling_minutes', deal.integrity_cooling_minutes,
    'binding_authority', deal.binding_authority,
    'external_agreements_binding', false
  ) order by deal.updated_at desc), '[]'::jsonb)
  into result_value
  from public.transfer_deals deal
  where deal.world_id = p_world_id
    and deal.status in ('agreed', 'completed', 'application_failed', 'cancelled_in_grace', 'mutually_cancelled')
    and exists (
      select 1 from public.transfer_deal_participants participant
      where participant.deal_id = deal.id and participant.club_id = club_id_value
    );

  return result_value;
end;
$$;

revoke all on function public.get_manager_transfer_lifecycle_for_user(uuid,text) from public, anon, authenticated;
grant execute on function public.get_manager_transfer_lifecycle_for_user(uuid,text) to service_role;

commit;
