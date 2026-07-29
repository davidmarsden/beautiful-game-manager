-- PR #151: persist a large scheduled-turn checkpoint through one guarded RPC.
-- The canonical save envelope can exceed the default PostgREST statement timeout during
-- a direct PATCH. Keep checksum compare-and-swap semantics while granting this one
-- service-role operation a controlled transaction-local timeout.

create or replace function public.replace_canonical_world_checkpoint(
  p_world_id text,
  p_previous_checksum text,
  p_replacement jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '90s'
as $$
declare
  v_row public.canonical_world_saves%rowtype;
begin
  update public.canonical_world_saves
  set
    save_version = p_replacement->>'save_version',
    save_checksum = p_replacement->>'save_checksum',
    save_envelope = p_replacement->'save_envelope',
    season_id = p_replacement->>'season_id',
    season_number = nullif(p_replacement->>'season_number', '')::integer,
    phase = p_replacement->>'phase',
    matchday = nullif(p_replacement->>'matchday', '')::integer,
    next_turn_at = nullif(p_replacement->>'next_turn_at', '')::timestamptz,
    turn_status = coalesce(nullif(p_replacement->>'turn_status', ''), 'open'),
    updated_at = coalesce(nullif(p_replacement->>'updated_at', '')::timestamptz, now())
  where world_id = p_world_id
    and save_checksum = p_previous_checksum
    and turn_status = 'locking'
  returning * into v_row;

  if not found then
    return jsonb_build_object(
      'accepted', false,
      'world_id', p_world_id,
      'reason', 'checkpoint_changed'
    );
  end if;

  return jsonb_build_object(
    'accepted', true,
    'world_id', v_row.world_id,
    'previous_checksum', p_previous_checksum,
    'replacement_checksum', v_row.save_checksum,
    'matchday', v_row.matchday,
    'turn_status', v_row.turn_status
  );
end;
$$;

revoke all on function public.replace_canonical_world_checkpoint(text, text, jsonb) from public;
revoke all on function public.replace_canonical_world_checkpoint(text, text, jsonb) from anon;
revoke all on function public.replace_canonical_world_checkpoint(text, text, jsonb) from authenticated;
grant execute on function public.replace_canonical_world_checkpoint(text, text, jsonb) to service_role;
