-- #240 production follow-up: first-class transfer history, compact read-model refresh,
-- and recovery of legacy combined-cap settlement failures after the 25/25 split-cap rule.

begin;

create or replace function public.get_manager_transfer_history_for_user(
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
  club_id_value text;
  cache_row public.world_read_model_cache;
  canonical_checksum text;
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

  select save_checksum into canonical_checksum
  from public.canonical_world_saves where world_id = p_world_id limit 1;
  select * into cache_row
  from public.world_read_model_cache where world_id = p_world_id limit 1;
  if cache_row.read_model is null or canonical_checksum is null or cache_row.source_checksum <> canonical_checksum then
    raise exception 'World read model is refreshing; please retry shortly';
  end if;

  with terminal_deals as (
    select
      deal.id,
      deal.status,
      deal.current_revision_no,
      deal.created_at,
      deal.updated_at,
      deal.terminal_at,
      deal.terminal_reason,
      deal.settlement_error,
      buyer.club_id as buyer_club_id,
      seller.club_id as seller_club_id,
      player_leg.player_id,
      coalesce(cash_leg.amount, 0) as fee,
      case when coalesce(player_leg.terms->>'contract_years', '') ~ '^[0-9]+$'
        then greatest(1, least((player_leg.terms->>'contract_years')::integer, 5)) else 3 end as contract_years
    from public.transfer_deals deal
    join public.transfer_deal_participants buyer on buyer.deal_id = deal.id and buyer.role = 'buyer'
    join public.transfer_deal_participants seller on seller.deal_id = deal.id and seller.role = 'seller'
    join public.transfer_deal_revisions revision
      on revision.deal_id = deal.id and revision.revision_no = deal.current_revision_no
    join public.transfer_deal_legs player_leg
      on player_leg.revision_id = revision.id and player_leg.leg_type = 'permanent_transfer'
    left join public.transfer_deal_legs cash_leg
      on cash_leg.revision_id = revision.id and cash_leg.leg_type = 'cash'
    where deal.world_id = p_world_id
      and deal.status not in ('negotiating', 'agreed')
      and (buyer.club_id = club_id_value or seller.club_id = club_id_value)
    order by coalesce(deal.terminal_at, deal.updated_at) desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', id,
    'status', status,
    'revision_no', current_revision_no,
    'player_id', player_id,
    'player_name', coalesce(
      cache_row.read_model #>> array['squad_cycle','players',player_id,'display_name'],
      cache_row.read_model #>> array['squad_cycle','players',player_id,'player_name'],
      player_id
    ),
    'buyer_club_id', buyer_club_id,
    'buyer_club_name', coalesce(
      cache_row.read_model #>> array['club_profiles',buyer_club_id,'club_name'],
      cache_row.read_model #>> array['club_profiles',buyer_club_id,'canonical_name'],
      buyer_club_id
    ),
    'seller_club_id', seller_club_id,
    'seller_club_name', coalesce(
      cache_row.read_model #>> array['club_profiles',seller_club_id,'club_name'],
      cache_row.read_model #>> array['club_profiles',seller_club_id,'canonical_name'],
      seller_club_id
    ),
    'direction', case when buyer_club_id = club_id_value then 'incoming' else 'outgoing' end,
    'counterpart_club_id', case when buyer_club_id = club_id_value then seller_club_id else buyer_club_id end,
    'counterpart_club_name', case when buyer_club_id = club_id_value then
      coalesce(cache_row.read_model #>> array['club_profiles',seller_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',seller_club_id,'canonical_name'], seller_club_id)
      else coalesce(cache_row.read_model #>> array['club_profiles',buyer_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',buyer_club_id,'canonical_name'], buyer_club_id) end,
    'fee', fee,
    'contract_years', contract_years,
    'terminal_reason', terminal_reason,
    'settlement_error', settlement_error,
    'created_at', created_at,
    'updated_at', updated_at,
    'terminal_at', terminal_at
  ) order by coalesce(terminal_at, updated_at) desc), '[]'::jsonb)
  into result_value
  from terminal_deals;

  return result_value;
end;
$$;

create or replace function public.refresh_world_read_model_if_current(
  p_world_id text,
  p_expected_checksum text,
  p_read_model jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  canonical_checksum text;
begin
  if trim(coalesce(p_world_id, '')) = '' then raise exception 'World is required'; end if;
  if trim(coalesce(p_expected_checksum, '')) = '' then raise exception 'Expected checksum is required'; end if;
  if p_read_model is null or jsonb_typeof(p_read_model) <> 'object' then raise exception 'Read model is required'; end if;

  select save_checksum into canonical_checksum
  from public.canonical_world_saves
  where world_id = p_world_id
  limit 1;

  if canonical_checksum is null then return jsonb_build_object('accepted', false, 'reason', 'world_not_found'); end if;
  if canonical_checksum <> p_expected_checksum then return jsonb_build_object('accepted', false, 'reason', 'checkpoint_changed'); end if;

  insert into public.world_read_model_cache(world_id, source_checksum, read_model, refreshed_at)
  values(p_world_id, p_expected_checksum, p_read_model, now())
  on conflict (world_id) do update
    set source_checksum = excluded.source_checksum,
        read_model = excluded.read_model,
        refreshed_at = excluded.refreshed_at;

  return jsonb_build_object('accepted', true, 'world_id', p_world_id, 'source_checksum', p_expected_checksum);
end;
$$;

-- A small number of first-class deals may have failed under the old combined
-- 25-player registration test even though the destination has room within the
-- new 25 senior / 25 youth ownership cohorts. Re-open only those exact failures.
with candidate as (
  select deal.id,
         player_leg.to_club_id,
         case
           when coalesce(cache.read_model #>> array['squad_cycle','players',player_leg.player_id,'age'], '') ~ '^[0-9]+$'
             then (cache.read_model #>> array['squad_cycle','players',player_leg.player_id,'age'])::integer
           else 99
         end as player_age,
         cache.read_model
  from public.transfer_deals deal
  join public.transfer_deal_revisions revision
    on revision.deal_id = deal.id and revision.revision_no = deal.current_revision_no
  join public.transfer_deal_legs player_leg
    on player_leg.revision_id = revision.id and player_leg.leg_type = 'permanent_transfer'
  join public.world_read_model_cache cache on cache.world_id = deal.world_id
  join public.canonical_world_saves canonical
    on canonical.world_id = deal.world_id and canonical.save_checksum = cache.source_checksum
  where deal.status = 'application_failed'
    and deal.terminal_reason = 'canonical_validation_failed'
    and deal.settlement_error ilike '%registration limit reached%'
), eligible as (
  select candidate.id
  from candidate
  where (
    select count(*)
    from jsonb_each(coalesce(candidate.read_model #> '{squad_cycle,players}', '{}'::jsonb)) player(key,value)
    where coalesce(player.value->>'club_id', '') = candidate.to_club_id
      and case when candidate.player_age <= 21
        then coalesce(player.value->>'age', '') ~ '^[0-9]+$' and (player.value->>'age')::integer <= 21
        else not (coalesce(player.value->>'age', '') ~ '^[0-9]+$') or (player.value->>'age')::integer > 21 end
  ) < 25
)
update public.transfer_deals deal
set status = 'agreed',
    settlement_error = null,
    terminal_reason = null,
    terminal_at = null,
    updated_at = now()
where deal.id in (select id from eligible);

revoke all on function public.get_manager_transfer_history_for_user(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.get_manager_transfer_history_for_user(uuid,text,integer) to service_role;
revoke all on function public.refresh_world_read_model_if_current(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.refresh_world_read_model_if_current(text,text,jsonb) to service_role;

commit;
