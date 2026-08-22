-- #272 Slice D: one due settlement row per deal with the complete current revision.
-- Replaces the straight-transfer flattening that could emit one due row per player leg.

begin;

create or replace function public.get_due_transfer_settlements(
  p_world_id text default null,
  p_limit integer default 10
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(row_value order by (row_value->>'settle_at')::timestamptz asc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'deal_id', deal.id,
      'world_id', deal.world_id,
      'revision_no', deal.current_revision_no,
      'revision_type', coalesce(revision.summary->>'type', ''),
      'settle_at', deal.settle_at,
      'legs', coalesce((
        select jsonb_agg(jsonb_build_object(
          'sequence_no', leg.sequence_no,
          'leg_type', leg.leg_type,
          'from_club_id', leg.from_club_id,
          'to_club_id', leg.to_club_id,
          'player_id', leg.player_id,
          'amount', leg.amount,
          'contract_years', case
            when coalesce(leg.terms->>'contract_years', '') ~ '^[0-9]+$'
              then greatest(1, least((leg.terms->>'contract_years')::integer, 5))
            else null
          end
        ) order by leg.sequence_no asc)
        from public.transfer_deal_legs leg
        where leg.revision_id = revision.id
      ), '[]'::jsonb)
    ) as row_value
    from public.transfer_deals deal
    join public.transfer_deal_revisions revision
      on revision.deal_id = deal.id and revision.revision_no = deal.current_revision_no
    where deal.status = 'agreed'
      and deal.settle_at is not null
      and deal.settle_at <= now()
      and (p_world_id is null or deal.world_id = p_world_id)
      and exists (
        select 1 from public.transfer_deal_legs leg
        where leg.revision_id = revision.id and leg.leg_type = 'permanent_transfer'
      )
    order by deal.settle_at asc
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ) due;
$$;

revoke all on function public.get_due_transfer_settlements(text,integer) from public, anon, authenticated;
grant execute on function public.get_due_transfer_settlements(text,integer) to service_role;

commit;
