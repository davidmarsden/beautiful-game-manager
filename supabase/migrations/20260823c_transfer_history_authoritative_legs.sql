-- #287/#272 production follow-up: expose authoritative terminal-deal legs to transfer history.
-- Buyer/seller role labels are compatibility metadata for two-club negotiation; revision legs
-- are authoritative for multi-player/exchange direction and deal-level cash presentation.

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
        then greatest(1, least((player_leg.terms->>'contract_years')::integer, 5)) else 3 end as contract_years,
      revision.id as revision_id
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
    'buyer_club_name', coalesce(cache_row.read_model #>> array['club_profiles',buyer_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',buyer_club_id,'canonical_name'], buyer_club_id),
    'seller_club_id', seller_club_id,
    'seller_club_name', coalesce(cache_row.read_model #>> array['club_profiles',seller_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',seller_club_id,'canonical_name'], seller_club_id),
    'direction', case when buyer_club_id = club_id_value then 'incoming' else 'outgoing' end,
    'counterpart_club_id', case when buyer_club_id = club_id_value then seller_club_id else buyer_club_id end,
    'counterpart_club_name', case when buyer_club_id = club_id_value then
      coalesce(cache_row.read_model #>> array['club_profiles',seller_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',seller_club_id,'canonical_name'], seller_club_id)
      else coalesce(cache_row.read_model #>> array['club_profiles',buyer_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',buyer_club_id,'canonical_name'], buyer_club_id) end,
    'fee', fee,
    'contract_years', contract_years,
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sequence_no', leg.sequence_no,
        'leg_type', leg.leg_type,
        'from_club_id', leg.from_club_id,
        'from_club_name', coalesce(cache_row.read_model #>> array['club_profiles',leg.from_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',leg.from_club_id,'canonical_name'], leg.from_club_id),
        'to_club_id', leg.to_club_id,
        'to_club_name', coalesce(cache_row.read_model #>> array['club_profiles',leg.to_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',leg.to_club_id,'canonical_name'], leg.to_club_id),
        'player_id', leg.player_id,
        'player_name', case when leg.player_id is null then null else coalesce(
          cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'display_name'],
          cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'player_name'],
          leg.player_id
        ) end,
        'amount', leg.amount,
        'contract_years', case when coalesce(leg.terms->>'contract_years', '') ~ '^[0-9]+$' then greatest(1, least((leg.terms->>'contract_years')::integer, 5)) else null end
      ) order by leg.sequence_no)
      from public.transfer_deal_legs leg
      where leg.revision_id = revision_id
    ), '[]'::jsonb),
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

revoke all on function public.get_manager_transfer_history_for_user(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.get_manager_transfer_history_for_user(uuid,text,integer) to service_role;

commit;
