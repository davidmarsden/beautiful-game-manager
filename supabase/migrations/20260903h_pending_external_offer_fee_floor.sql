-- Close the deployment window for external offers submitted before the
-- minimum acquisition-fee guard existed. New submissions are normalized by
-- external-market.mjs; this backfill ensures already-pending external offers
-- cannot later settle with a zero/sub-threshold acquisition fee.

update public.free_agent_offers
set player_snapshot = jsonb_set(
      coalesce(player_snapshot, '{}'::jsonb),
      '{external_acquisition_fee_eur}',
      to_jsonb(100000::bigint),
      true
    ),
    updated_at = now()
where status = 'pending'
  and coalesce(player_snapshot->>'acquisition_type', '') = 'external_transfermarkt'
  and (
    case
      when coalesce(player_snapshot->>'external_acquisition_fee_eur', '') ~ '^[0-9]+([.][0-9]+)?$'
        then (player_snapshot->>'external_acquisition_fee_eur')::numeric
      else 0
    end
  ) < 100000;
