begin;

create or replace function public.assert_transfer_revision_has_reciprocal_consideration(
  p_deal_id uuid,
  p_revision_id uuid
) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  buyer_club_id_value text;
  seller_club_id_value text;
  has_seller_to_buyer_player boolean := false;
  has_buyer_to_seller_consideration boolean := false;
begin
  select participant.club_id into buyer_club_id_value
  from public.transfer_deal_participants participant
  where participant.deal_id = p_deal_id and participant.role = 'buyer'
  limit 1;

  select participant.club_id into seller_club_id_value
  from public.transfer_deal_participants participant
  where participant.deal_id = p_deal_id and participant.role = 'seller'
  limit 1;

  if buyer_club_id_value is null or seller_club_id_value is null then
    raise exception 'Transfer deal participants are incomplete';
  end if;

  select exists(
    select 1
    from public.transfer_deal_legs leg
    where leg.revision_id = p_revision_id
      and leg.leg_type = 'permanent_transfer'
      and leg.from_club_id = seller_club_id_value
      and leg.to_club_id = buyer_club_id_value
      and nullif(trim(coalesce(leg.player_id, '')), '') is not null
  ) into has_seller_to_buyer_player;

  select exists(
    select 1
    from public.transfer_deal_legs leg
    where leg.revision_id = p_revision_id
      and leg.from_club_id = buyer_club_id_value
      and leg.to_club_id = seller_club_id_value
      and (
        (leg.leg_type = 'cash' and coalesce(leg.amount, 0) > 0)
        or
        (leg.leg_type = 'permanent_transfer' and nullif(trim(coalesce(leg.player_id, '')), '') is not null)
      )
  ) into has_buyer_to_seller_consideration;

  if not has_seller_to_buyer_player then
    raise exception 'Transfer offer must include a player moving from the selling club to the buying club';
  end if;

  if not has_buyer_to_seller_consideration then
    raise exception 'Transfer offer must include cash or a player moving from the buying club to the selling club';
  end if;
end;
$$;

create or replace function public.guard_transfer_approval_consideration()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  deal_id_value uuid;
begin
  if new.decision <> 'approved' then return new; end if;

  select revision.deal_id into deal_id_value
  from public.transfer_deal_revisions revision
  where revision.id = new.revision_id;

  if deal_id_value is null then raise exception 'Transfer revision was not found'; end if;
  perform public.assert_transfer_revision_has_reciprocal_consideration(deal_id_value, new.revision_id);
  return new;
end;
$$;

drop trigger if exists transfer_approval_consideration_guard on public.transfer_deal_approvals;
create trigger transfer_approval_consideration_guard
before insert or update of decision on public.transfer_deal_approvals
for each row execute function public.guard_transfer_approval_consideration();

create or replace function public.guard_transfer_state_consideration()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  revision_id_value uuid;
begin
  if new.status not in ('agreed','grace_period','binding','settling') then return new; end if;
  if new.status = old.status then return new; end if;

  select revision.id into revision_id_value
  from public.transfer_deal_revisions revision
  where revision.deal_id = new.id
    and revision.revision_no = new.current_revision_no
  limit 1;

  if revision_id_value is null then raise exception 'Current transfer revision was not found'; end if;
  perform public.assert_transfer_revision_has_reciprocal_consideration(new.id, revision_id_value);
  return new;
end;
$$;

drop trigger if exists transfer_state_consideration_guard on public.transfer_deals;
create trigger transfer_state_consideration_guard
before update of status on public.transfer_deals
for each row execute function public.guard_transfer_state_consideration();

-- Retire malformed live offers created before the guard existed.
with malformed as (
  select deal.id
  from public.transfer_deals deal
  join public.transfer_deal_participants buyer
    on buyer.deal_id = deal.id and buyer.role = 'buyer'
  join public.transfer_deal_participants seller
    on seller.deal_id = deal.id and seller.role = 'seller'
  join public.transfer_deal_revisions revision
    on revision.deal_id = deal.id and revision.revision_no = deal.current_revision_no
  where deal.status = 'negotiating'
    and exists (
      select 1 from public.transfer_deal_legs leg
      where leg.revision_id = revision.id
        and leg.leg_type = 'permanent_transfer'
        and leg.from_club_id = seller.club_id
        and leg.to_club_id = buyer.club_id
    )
    and not exists (
      select 1 from public.transfer_deal_legs leg
      where leg.revision_id = revision.id
        and leg.from_club_id = buyer.club_id
        and leg.to_club_id = seller.club_id
        and (
          (leg.leg_type = 'cash' and coalesce(leg.amount, 0) > 0)
          or leg.leg_type = 'permanent_transfer'
        )
    )
)
update public.transfer_deals deal
set status = 'withdrawn',
    terminal_reason = 'invalid_zero_consideration_offer',
    terminal_at = now(),
    updated_at = now()
from malformed
where deal.id = malformed.id;

revoke all on function public.assert_transfer_revision_has_reciprocal_consideration(uuid,uuid) from public, anon, authenticated;
revoke all on function public.guard_transfer_approval_consideration() from public, anon, authenticated;
revoke all on function public.guard_transfer_state_consideration() from public, anon, authenticated;
grant execute on function public.assert_transfer_revision_has_reciprocal_consideration(uuid,uuid) to service_role;
grant execute on function public.guard_transfer_approval_consideration() to service_role;
grant execute on function public.guard_transfer_state_consideration() to service_role;

commit;
