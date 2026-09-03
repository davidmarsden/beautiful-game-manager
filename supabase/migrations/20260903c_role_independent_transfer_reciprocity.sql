begin;

-- Follow-up to #386/#387 Codex review. Transfer legs, not legacy buyer/seller
-- labels, are authoritative. A valid two-club revision must:
--   * involve exactly the two deal participants,
--   * contain at least one permanent player leg,
--   * contain meaningful consideration in both directions.
create or replace function public.assert_transfer_revision_has_reciprocal_consideration(
  p_deal_id uuid,
  p_revision_id uuid
) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  participant_clubs text[];
  participant_count integer;
  meaningful_clubs text[];
  meaningful_club_count integer;
  direction_count integer;
  player_leg_count integer;
begin
  select array_agg(distinct participant.club_id order by participant.club_id),
         count(distinct participant.club_id)
    into participant_clubs, participant_count
  from public.transfer_deal_participants participant
  where participant.deal_id = p_deal_id;

  if participant_count <> 2 then
    raise exception 'Transfer deal must have exactly two participating clubs';
  end if;

  with meaningful as (
    select leg.*
    from public.transfer_deal_legs leg
    where leg.revision_id = p_revision_id
      and leg.from_club_id is not null
      and leg.to_club_id is not null
      and leg.from_club_id <> leg.to_club_id
      and (
        (leg.leg_type = 'cash' and coalesce(leg.amount, 0) > 0)
        or
        (leg.leg_type = 'permanent_transfer' and nullif(trim(coalesce(leg.player_id, '')), '') is not null)
      )
  ), clubs as (
    select from_club_id as club_id from meaningful
    union
    select to_club_id as club_id from meaningful
  )
  select array_agg(club_id order by club_id), count(*)
    into meaningful_clubs, meaningful_club_count
  from clubs;

  if meaningful_club_count <> 2 or meaningful_clubs is distinct from participant_clubs then
    raise exception 'Every meaningful transfer leg must involve exactly the two participating clubs';
  end if;

  select count(*)
    into player_leg_count
  from public.transfer_deal_legs leg
  where leg.revision_id = p_revision_id
    and leg.leg_type = 'permanent_transfer'
    and nullif(trim(coalesce(leg.player_id, '')), '') is not null;

  if player_leg_count < 1 then
    raise exception 'Transfer revision must include at least one player';
  end if;

  select count(distinct concat(leg.from_club_id, '->', leg.to_club_id))
    into direction_count
  from public.transfer_deal_legs leg
  where leg.revision_id = p_revision_id
    and leg.from_club_id = any(participant_clubs)
    and leg.to_club_id = any(participant_clubs)
    and leg.from_club_id <> leg.to_club_id
    and (
      (leg.leg_type = 'cash' and coalesce(leg.amount, 0) > 0)
      or
      (leg.leg_type = 'permanent_transfer' and nullif(trim(coalesce(leg.player_id, '')), '') is not null)
    );

  if direction_count <> 2 then
    raise exception 'Transfer revision must include meaningful consideration in both directions';
  end if;
end;
$$;

-- Retire malformed pre-guard deals in every non-terminal state. The assertion is
-- deliberately reused here so cleanup follows exactly the same model rule as new
-- approvals and state transitions. Valid reverse-direction exchanges are retained.
do $$
declare
  candidate record;
begin
  for candidate in
    select deal.id, deal.status, revision.id as revision_id
    from public.transfer_deals deal
    join public.transfer_deal_revisions revision
      on revision.deal_id = deal.id
     and revision.revision_no = deal.current_revision_no
    where deal.status in ('negotiating','agreed','grace_period','binding','settling')
  loop
    begin
      perform public.assert_transfer_revision_has_reciprocal_consideration(candidate.id, candidate.revision_id);
    exception when others then
      update public.transfer_deals
         set status = 'application_failed',
             terminal_reason = 'invalid_nonreciprocal_transfer_revision',
             settlement_error = sqlerrm,
             terminal_at = now(),
             updated_at = now()
       where id = candidate.id;
    end;
  end loop;
end;
$$;

revoke all on function public.assert_transfer_revision_has_reciprocal_consideration(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.assert_transfer_revision_has_reciprocal_consideration(uuid,uuid)
  to service_role;

commit;
