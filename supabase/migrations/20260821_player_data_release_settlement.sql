begin;

create or replace function public.apply_player_data_release_settlement(
  p_world_id text,
  p_expected_checksum text,
  p_replacement jsonb,
  p_release_ids jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  world_row public.canonical_world_saves;
  replacement_checksum_value text := p_replacement->>'save_checksum';
  replacement_read_model jsonb := p_replacement->'read_model';
begin
  if trim(coalesce(p_world_id, '')) = '' then raise exception 'World is required'; end if;
  if trim(coalesce(p_expected_checksum, '')) = '' then raise exception 'Expected canonical checksum is required'; end if;
  if trim(coalesce(replacement_checksum_value, '')) = '' then raise exception 'Replacement checksum is required'; end if;
  if replacement_read_model is null or jsonb_typeof(replacement_read_model) <> 'object' then raise exception 'Compact replacement read model is required'; end if;
  if p_release_ids is null or jsonb_typeof(p_release_ids) <> 'array' or jsonb_array_length(p_release_ids) = 0 then raise exception 'Applied release ids are required'; end if;

  update public.canonical_world_saves
  set save_version = p_replacement->>'save_version',
      save_checksum = replacement_checksum_value,
      save_envelope = p_replacement->'save_envelope',
      season_id = p_replacement->>'season_id',
      season_number = nullif(p_replacement->>'season_number', '')::integer,
      phase = p_replacement->>'phase',
      matchday = nullif(p_replacement->>'matchday', '')::integer,
      next_turn_at = nullif(p_replacement->>'next_turn_at', '')::timestamptz,
      turn_status = p_replacement->>'turn_status',
      updated_at = nullif(p_replacement->>'updated_at', '')::timestamptz
  where world_id = p_world_id
    and save_checksum = p_expected_checksum
    and turn_status = 'open'
  returning * into world_row;

  if world_row.world_id is null then
    return jsonb_build_object('accepted', false, 'reason', 'checkpoint_changed_or_busy');
  end if;

  insert into public.world_read_model_cache(world_id, source_checksum, read_model, refreshed_at)
  values(p_world_id, replacement_checksum_value, replacement_read_model, now())
  on conflict (world_id) do update
    set source_checksum = excluded.source_checksum,
        read_model = excluded.read_model,
        refreshed_at = excluded.refreshed_at;

  return jsonb_build_object(
    'accepted', true,
    'world_id', p_world_id,
    'previous_checksum', p_expected_checksum,
    'replacement_checksum', replacement_checksum_value,
    'release_ids', p_release_ids
  );
end;
$$;

revoke all on function public.apply_player_data_release_settlement(text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.apply_player_data_release_settlement(text,text,jsonb,jsonb) to service_role;

commit;
