-- Keep the free-agent settlement CAS function explicit about the replacement checksum
-- so PL/pgSQL never has to resolve a local variable against the identically named column.

begin;

create or replace function public.apply_free_agent_acquisition_settlement(
  p_acquisition_id uuid,
  p_expected_checksum text,
  p_replacement jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  acquisition_row public.player_acquisitions;
  world_row public.canonical_world_saves;
  replacement_checksum_value text := p_replacement->>'save_checksum';
  replacement_read_model jsonb := p_replacement->'read_model';
begin
  if p_acquisition_id is null then raise exception 'Acquisition is required'; end if;
  if trim(coalesce(p_expected_checksum, '')) = '' then raise exception 'Expected canonical checksum is required'; end if;
  if trim(coalesce(replacement_checksum_value, '')) = '' then raise exception 'Replacement checksum is required'; end if;
  if replacement_read_model is null or jsonb_typeof(replacement_read_model) <> 'object' then raise exception 'Compact replacement read model is required'; end if;

  select * into acquisition_row
  from public.player_acquisitions
  where id = p_acquisition_id
  for update;
  if acquisition_row.id is null then return jsonb_build_object('accepted', false, 'reason', 'acquisition_not_found'); end if;
  if acquisition_row.status = 'completed' then
    return jsonb_build_object(
      'accepted', acquisition_row.replacement_checksum = replacement_checksum_value,
      'reason', 'already_completed',
      'acquisition_id', acquisition_row.id,
      'replacement_checksum', acquisition_row.replacement_checksum
    );
  end if;
  if acquisition_row.status <> 'pending' then return jsonb_build_object('accepted', false, 'reason', 'acquisition_not_settleable'); end if;

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
  where world_id = acquisition_row.world_id
    and save_checksum = p_expected_checksum
    and turn_status = 'open'
  returning * into world_row;

  if world_row.world_id is null then return jsonb_build_object('accepted', false, 'reason', 'checkpoint_changed_or_busy'); end if;

  insert into public.world_read_model_cache(world_id, source_checksum, read_model, refreshed_at)
  values(acquisition_row.world_id, replacement_checksum_value, replacement_read_model, now())
  on conflict (world_id) do update
    set source_checksum = excluded.source_checksum,
        read_model = excluded.read_model,
        refreshed_at = excluded.refreshed_at;

  update public.player_acquisitions
  set status = 'completed',
      previous_checksum = p_expected_checksum,
      replacement_checksum = replacement_checksum_value,
      application_error = null,
      terminal_at = now(),
      updated_at = now()
  where id = acquisition_row.id
  returning * into acquisition_row;

  return jsonb_build_object(
    'accepted', true,
    'acquisition_id', acquisition_row.id,
    'status', acquisition_row.status,
    'previous_checksum', acquisition_row.previous_checksum,
    'replacement_checksum', acquisition_row.replacement_checksum
  );
end;
$$;

revoke all on function public.apply_free_agent_acquisition_settlement(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_free_agent_acquisition_settlement(uuid,text,jsonb) to service_role;

commit;
