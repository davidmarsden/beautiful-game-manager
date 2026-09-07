-- Candidate queue for the external-market scheduler. Active listings that already
-- have an external offer do not occupy the front of the queue and starve later listings.

begin;

create or replace function public.get_external_offer_candidate_listings(
  p_world_id text default null,
  p_limit integer default 20
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', listing.id,
    'world_id', listing.world_id,
    'player_id', listing.player_id,
    'club_id', listing.club_id,
    'manager_id', listing.manager_id,
    'asking_fee', listing.asking_fee,
    'created_at', listing.created_at,
    'updated_at', listing.updated_at
  ) order by listing.created_at asc, listing.id asc), '[]'::jsonb)
  from (
    select listing.*
    from public.transfer_market_listings listing
    where listing.status = 'active'
      and (p_world_id is null or listing.world_id = p_world_id)
      and not exists (
        select 1
        from public.transfer_deals deal
        where deal.listing_id = listing.id
          and deal.deal_origin = 'external_market'
      )
    order by listing.created_at asc, listing.id asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  ) listing;
$$;

revoke all on function public.get_external_offer_candidate_listings(text,integer)
  from public, anon, authenticated;
grant execute on function public.get_external_offer_candidate_listings(text,integer)
  to service_role;

commit;
