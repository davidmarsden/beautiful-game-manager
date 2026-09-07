-- External transfer offers: real TPF clubs outside the managed TBG world can
-- make first-class offers for listed players. The offer itself is system-authored,
-- but the selling manager still accepts or declines it through the normal deal flow.

begin;

alter table public.transfer_deals
  alter column created_by_manager_id drop not null;
alter table public.transfer_deal_revisions
  alter column created_by_manager_id drop not null;
alter table public.transfer_deal_approvals
  alter column manager_id drop not null;

alter table public.transfer_deals
  add column if not exists deal_origin text not null default 'managed'
    check (deal_origin in ('managed', 'external_market')),
  add column if not exists external_club_source_id text,
  add column if not exists external_club_name text;

create unique index if not exists transfer_deals_external_listing_club_uidx
  on public.transfer_deals(listing_id, external_club_source_id)
  where deal_origin = 'external_market'
    and listing_id is not null
    and external_club_source_id is not null;

create index if not exists transfer_deals_external_market_idx
  on public.transfer_deals(world_id, deal_origin, status, updated_at desc);

create or replace function public.create_external_transfer_offer(
  p_world_id text,
  p_listing_id uuid,
  p_external_club_source_id text,
  p_external_club_name text,
  p_fee numeric,
  p_contract_years integer default 3
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  listing_row public.transfer_market_listings;
  deal_row public.transfer_deals;
  revision_row public.transfer_deal_revisions;
  cache_row public.world_read_model_cache;
  canonical_checksum text;
  external_source_id text := trim(coalesce(p_external_club_source_id, ''));
  external_name text := trim(coalesce(p_external_club_name, ''));
  fee_value numeric := greatest(coalesce(p_fee, 0), 0);
  contract_years_value integer := greatest(1, least(coalesce(p_contract_years, 3), 5));
begin
  if trim(coalesce(p_world_id, '')) = '' then raise exception 'World is required'; end if;
  if p_listing_id is null then raise exception 'Transfer listing is required'; end if;
  if external_source_id = '' then raise exception 'External club source ID is required'; end if;
  if external_name = '' then raise exception 'External club name is required'; end if;
  if fee_value <= 0 then raise exception 'External offer requires a positive fee'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(concat_ws('|', p_world_id, p_listing_id::text, external_source_id), 0)
  );

  select * into listing_row
  from public.transfer_market_listings listing
  where listing.id = p_listing_id
    and listing.world_id = p_world_id
    and listing.status = 'active'
  for update;
  if listing_row.id is null then raise exception 'Transfer listing is no longer active'; end if;

  select save_checksum into canonical_checksum
  from public.canonical_world_saves
  where world_id = p_world_id
  limit 1;
  select * into cache_row
  from public.world_read_model_cache
  where world_id = p_world_id
  limit 1;
  if cache_row.read_model is null
     or canonical_checksum is null
     or cache_row.source_checksum <> canonical_checksum then
    raise exception 'World read model is refreshing; please retry shortly';
  end if;
  if coalesce(cache_row.read_model #>> array['squad_cycle','players',listing_row.player_id,'club_id'], '') <> listing_row.club_id then
    raise exception 'Listed player is no longer owned by the selling club';
  end if;

  select * into deal_row
  from public.transfer_deals deal
  where deal.listing_id = p_listing_id
    and deal.deal_origin = 'external_market'
    and deal.external_club_source_id = external_source_id
  limit 1;
  if deal_row.id is not null then
    return jsonb_build_object(
      'deal_id', deal_row.id,
      'status', deal_row.status,
      'idempotent', true,
      'external_club_source_id', deal_row.external_club_source_id,
      'external_club_name', deal_row.external_club_name
    );
  end if;

  insert into public.transfer_deals(
    world_id, listing_id, created_by_manager_id, status, current_revision_no,
    deal_origin, external_club_source_id, external_club_name
  ) values (
    p_world_id, listing_row.id, null, 'negotiating', 1,
    'external_market', external_source_id, external_name
  ) returning * into deal_row;

  insert into public.transfer_deal_revisions(deal_id, revision_no, created_by_manager_id, summary)
  values(
    deal_row.id,
    1,
    null,
    jsonb_build_object(
      'type', 'external_market_offer',
      'player_id', listing_row.player_id,
      'fee', fee_value,
      'contract_years', contract_years_value,
      'external_club_source_id', external_source_id,
      'external_club_name', external_name,
      'source', 'beautiful-game-data/player-database'
    )
  ) returning * into revision_row;

  insert into public.transfer_deal_participants(deal_id, club_id, manager_id, role) values
    (deal_row.id, external_name, null, 'buyer'),
    (deal_row.id, listing_row.club_id, listing_row.manager_id, 'seller');

  insert into public.transfer_deal_legs(
    revision_id, sequence_no, leg_type, from_club_id, to_club_id, player_id, terms
  ) values (
    revision_row.id, 1, 'permanent_transfer', listing_row.club_id, external_name, listing_row.player_id,
    jsonb_build_object(
      'contract_years', contract_years_value,
      'external_club_source_id', external_source_id,
      'external_club_name', external_name
    )
  );

  insert into public.transfer_deal_legs(
    revision_id, sequence_no, leg_type, from_club_id, to_club_id, amount, terms
  ) values (
    revision_row.id, 2, 'cash', external_name, listing_row.club_id, fee_value,
    jsonb_build_object(
      'external_club_source_id', external_source_id,
      'external_club_name', external_name
    )
  );

  -- The external club's system-generated offer is its approval of revision 1.
  -- The human selling manager supplies the second approval through the existing responder.
  insert into public.transfer_deal_approvals(revision_id, club_id, manager_id, decision)
  values(revision_row.id, external_name, null, 'approved');

  return jsonb_build_object(
    'deal_id', deal_row.id,
    'status', deal_row.status,
    'revision_no', 1,
    'external_offer', true,
    'external_club_source_id', external_source_id,
    'external_club_name', external_name,
    'fee', fee_value
  );
end;
$$;

revoke all on function public.create_external_transfer_offer(text,uuid,text,text,numeric,integer)
  from public, anon, authenticated;
grant execute on function public.create_external_transfer_offer(text,uuid,text,text,numeric,integer)
  to service_role;

-- External offers are deliberately firm in the first implementation. A seller can
-- accept or decline; a future external-club negotiation model can replace this guard.
create or replace function public.guard_external_transfer_counter()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.revision_no > 1 and exists (
    select 1 from public.transfer_deals deal
    where deal.id = new.deal_id and deal.deal_origin = 'external_market'
  ) then
    raise exception 'External club offers are firm: accept or decline this offer';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_external_transfer_counter on public.transfer_deal_revisions;
create trigger guard_external_transfer_counter
before insert on public.transfer_deal_revisions
for each row execute function public.guard_external_transfer_counter();

-- Preserve external provenance in the due-settlement payload so the settlement
-- worker can move the player out of managed ownership without inventing a managed club.
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
      'deal_origin', deal.deal_origin,
      'external_club_source_id', deal.external_club_source_id,
      'external_club_name', deal.external_club_name,
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

revoke all on function public.get_due_transfer_settlements(text,integer)
  from public, anon, authenticated;
grant execute on function public.get_due_transfer_settlements(text,integer)
  to service_role;

commit;
