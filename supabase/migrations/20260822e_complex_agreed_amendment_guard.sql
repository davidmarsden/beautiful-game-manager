-- #272: legacy agreed-deal amendments only model one player + one fee.
-- Fail closed for multi-player revisions until full-leg agreed amendments exist.

begin;

create or replace function public.guard_complex_transfer_change_request()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_revision_id uuid;
  permanent_player_count integer;
begin
  if new.change_type <> 'amendment' then
    return new;
  end if;

  select revision.id
    into current_revision_id
  from public.transfer_deals deal
  join public.transfer_deal_revisions revision
    on revision.deal_id = deal.id
   and revision.revision_no = deal.current_revision_no
  where deal.id = new.deal_id
    and deal.world_id = new.world_id;

  if current_revision_id is null then
    raise exception 'Current agreed transfer revision was not found';
  end if;

  select count(*)::integer
    into permanent_player_count
  from public.transfer_deal_legs leg
  where leg.revision_id = current_revision_id
    and leg.leg_type = 'permanent_transfer';

  if permanent_player_count > 1 then
    raise exception 'Legacy single-player amendments are not supported for multi-player deals; cancel and renegotiate the complete deal instead';
  end if;

  return new;
end;
$$;

create or replace function public.guard_complex_mutual_amendment_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  superseded_revision_no integer;
  superseded_revision_id uuid;
  permanent_player_count integer;
begin
  if coalesce(new.summary ->> 'type', '') <> 'mutual_agreed_amendment' then
    return new;
  end if;

  superseded_revision_no := nullif(new.summary ->> 'supersedes_revision_no', '')::integer;
  if superseded_revision_no is null then
    raise exception 'Mutual agreed amendment is missing superseded revision metadata';
  end if;

  select revision.id
    into superseded_revision_id
  from public.transfer_deal_revisions revision
  where revision.deal_id = new.deal_id
    and revision.revision_no = superseded_revision_no;

  if superseded_revision_id is null then
    raise exception 'Superseded agreed transfer revision was not found';
  end if;

  select count(*)::integer
    into permanent_player_count
  from public.transfer_deal_legs leg
  where leg.revision_id = superseded_revision_id
    and leg.leg_type = 'permanent_transfer';

  if permanent_player_count > 1 then
    raise exception 'Legacy single-player amendment cannot replace a multi-player deal revision';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_complex_transfer_change_request_trigger
  on public.transfer_deal_change_requests;
create trigger guard_complex_transfer_change_request_trigger
before insert or update of change_type, deal_id, world_id
on public.transfer_deal_change_requests
for each row execute function public.guard_complex_transfer_change_request();

drop trigger if exists guard_complex_mutual_amendment_revision_trigger
  on public.transfer_deal_revisions;
create trigger guard_complex_mutual_amendment_revision_trigger
before insert
on public.transfer_deal_revisions
for each row execute function public.guard_complex_mutual_amendment_revision();

revoke all on function public.guard_complex_transfer_change_request() from public, anon, authenticated;
revoke all on function public.guard_complex_mutual_amendment_revision() from public, anon, authenticated;

grant execute on function public.guard_complex_transfer_change_request() to service_role;
grant execute on function public.guard_complex_mutual_amendment_revision() to service_role;

commit;
