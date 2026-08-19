-- #240 follow-up: settlement must refresh the compact read model, never cache the full canonical world.

begin;

create or replace function public.apply_transfer_deal_settlement(
  p_deal_id uuid,
  p_expected_checksum text,
  p_replacement jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deal_row public.transfer_deals;
  world_row public.canonical_world_saves;
  replacement_checksum text := p_replacement->>'save_checksum';
  replacement_read_model jsonb := p_replacement->'read_model';
  request_key_value text;
begin
  if p_deal_id is null then raise exception 'Deal is required'; end if;
  if trim(coalesce(p_expected_checksum, '')) = '' then raise exception 'Expected canonical checksum is required'; end if;
  if trim(coalesce(replacement_checksum, '')) = '' then raise exception 'Replacement checksum is required'; end if;
  if replacement_read_model is null or jsonb_typeof(replacement_read_model) <> 'object' then
    raise exception 'Compact replacement read model is required';
  end if;

  select * into deal_row
  from public.transfer_deals
  where id = p_deal_id
  for update;
  if deal_row.id is null then return jsonb_build_object('accepted', false, 'reason', 'deal_not_found'); end if;
  if deal_row.status = 'completed' then
    return jsonb_build_object(
      'accepted', deal_row.settlement_replacement_checksum = replacement_checksum,
      'reason', 'already_completed',
      'deal_id', deal_row.id,
      'replacement_checksum', deal_row.settlement_replacement_checksum
    );
  end if;
  if deal_row.status <> 'agreed' then return jsonb_build_object('accepted', false, 'reason', 'deal_not_settleable'); end if;
  if deal_row.settle_at is null or deal_row.settle_at > now() then return jsonb_build_object('accepted', false, 'reason', 'settlement_not_due'); end if;

  update public.canonical_world_saves
  set save_version = p_replacement->>'save_version',
      save_checksum = replacement_checksum,
      save_envelope = p_replacement->'save_envelope',
      season_id = p_replacement->>'season_id',
      season_number = nullif(p_replacement->>'season_number', '')::integer,
      phase = p_replacement->>'phase',
      matchday = nullif(p_replacement->>'matchday', '')::integer,
      next_turn_at = nullif(p_replacement->>'next_turn_at', '')::timestamptz,
      turn_status = p_replacement->>'turn_status',
      updated_at = nullif(p_replacement->>'updated_at', '')::timestamptz
  where world_id = deal_row.world_id
    and save_checksum = p_expected_checksum
    and turn_status = 'open'
  returning * into world_row;

  if world_row.world_id is null then
    return jsonb_build_object('accepted', false, 'reason', 'checkpoint_changed_or_busy');
  end if;

  insert into public.world_read_model_cache(world_id, source_checksum, read_model, refreshed_at)
  values(deal_row.world_id, replacement_checksum, replacement_read_model, now())
  on conflict (world_id) do update
    set source_checksum = excluded.source_checksum,
        read_model = excluded.read_model,
        refreshed_at = excluded.refreshed_at;

  update public.transfer_deals
  set status = 'completed',
      settlement_previous_checksum = p_expected_checksum,
      settlement_replacement_checksum = replacement_checksum,
      settlement_error = null,
      settlement_attempts = settlement_attempts + 1,
      terminal_reason = 'settled_to_canonical_world',
      terminal_at = now(),
      updated_at = now()
  where id = deal_row.id
  returning * into deal_row;

  if deal_row.listing_id is not null then
    update public.transfer_market_listings
    set status = 'withdrawn', withdrawn_at = coalesce(withdrawn_at, now()), updated_at = now()
    where id = deal_row.listing_id and status = 'active';
  end if;

  request_key_value := concat('settlement:', replacement_checksum);
  insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
  values(
    deal_row.id,
    deal_row.world_id,
    deal_row.created_by_manager_id,
    'settlement_completed',
    request_key_value,
    jsonb_build_object(
      'revision_no', deal_row.current_revision_no,
      'previous_checksum', p_expected_checksum,
      'replacement_checksum', replacement_checksum
    )
  ) on conflict (world_id, manager_id, request_key) do nothing;

  return jsonb_build_object(
    'accepted', true,
    'deal_id', deal_row.id,
    'status', deal_row.status,
    'previous_checksum', p_expected_checksum,
    'replacement_checksum', replacement_checksum
  );
end;
$$;

revoke all on function public.apply_transfer_deal_settlement(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_transfer_deal_settlement(uuid,text,jsonb) to service_role;

commit;
