-- #240 Slice D: free agents receive competing contract offers before choosing a club.

begin;

create table if not exists public.free_agent_offers (
  id uuid primary key default gen_random_uuid(),
  world_id text not null,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  club_id text not null,
  player_id text not null,
  transfermarkt_id text,
  player_name text not null,
  player_snapshot jsonb not null default '{}'::jsonb,
  contract_years integer not null check (contract_years between 1 and 5),
  wage bigint not null check (wage >= 0),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','withdrawn','application_failed')),
  decision_at timestamptz not null,
  request_key text not null,
  offer_score numeric,
  minimum_score numeric,
  decision_reason text,
  acquisition_id uuid references public.player_acquisitions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal_at timestamptz
);

create unique index if not exists free_agent_offers_request_uidx
  on public.free_agent_offers(world_id, manager_id, request_key);
create unique index if not exists free_agent_offers_one_pending_manager_player_uidx
  on public.free_agent_offers(world_id, manager_id, player_id)
  where status = 'pending';
create index if not exists free_agent_offers_due_idx
  on public.free_agent_offers(world_id, status, decision_at, player_id);
create index if not exists free_agent_offers_club_history_idx
  on public.free_agent_offers(world_id, club_id, updated_at desc);

alter table public.free_agent_offers enable row level security;
revoke all on public.free_agent_offers from public, anon, authenticated;
grant select, insert, update on public.free_agent_offers to service_role;

create or replace function public.submit_free_agent_offer_for_user(
  p_user_id uuid,
  p_world_id text,
  p_player_id text,
  p_transfermarkt_id text,
  p_player_name text,
  p_player_snapshot jsonb,
  p_contract_years integer,
  p_wage bigint,
  p_request_key text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  existing_request public.free_agent_offers;
  existing_offer public.free_agent_offers;
  shared_decision_at timestamptz;
  row_value public.free_agent_offers;
begin
  if trim(coalesce(p_world_id, '')) = '' then raise exception 'World is required'; end if;
  if trim(coalesce(p_player_id, '')) = '' then raise exception 'Player is required'; end if;
  if trim(coalesce(p_player_name, '')) = '' then raise exception 'Player name is required'; end if;
  if trim(coalesce(p_request_key, '')) = '' then raise exception 'Request key is required'; end if;
  if coalesce(p_contract_years, 3) < 1 or coalesce(p_contract_years, 3) > 5 then raise exception 'Contract length must be between 1 and 5 seasons'; end if;
  if coalesce(p_wage, 0) < 0 then raise exception 'Wage cannot be negative'; end if;

  select profile.id, appointment.club_id
    into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if manager_id_value is null or club_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws('|', p_world_id, p_player_id), 0));

  select * into existing_request
  from public.free_agent_offers
  where world_id = p_world_id and manager_id = manager_id_value and request_key = p_request_key
  limit 1;
  if existing_request.id is not null then
    return to_jsonb(existing_request) || jsonb_build_object('accepted', true, 'idempotent', true);
  end if;

  select min(decision_at) into shared_decision_at
  from public.free_agent_offers
  where world_id = p_world_id and player_id = p_player_id and status = 'pending';
  shared_decision_at := coalesce(shared_decision_at, now() + interval '6 hours');

  select * into existing_offer
  from public.free_agent_offers
  where world_id = p_world_id and manager_id = manager_id_value and player_id = p_player_id and status = 'pending'
  for update;

  if existing_offer.id is not null then
    update public.free_agent_offers
    set club_id = club_id_value,
        transfermarkt_id = nullif(trim(coalesce(p_transfermarkt_id, '')), ''),
        player_name = p_player_name,
        player_snapshot = coalesce(p_player_snapshot, '{}'::jsonb),
        contract_years = p_contract_years,
        wage = p_wage,
        request_key = p_request_key,
        updated_at = now()
    where id = existing_offer.id
    returning * into row_value;
  else
    insert into public.free_agent_offers(
      world_id, manager_id, club_id, player_id, transfermarkt_id, player_name,
      player_snapshot, contract_years, wage, decision_at, request_key
    ) values (
      p_world_id, manager_id_value, club_id_value, p_player_id,
      nullif(trim(coalesce(p_transfermarkt_id, '')), ''), p_player_name,
      coalesce(p_player_snapshot, '{}'::jsonb), p_contract_years, p_wage,
      shared_decision_at, p_request_key
    ) returning * into row_value;
  end if;

  return to_jsonb(row_value) || jsonb_build_object('accepted', true, 'idempotent', false);
end;
$$;

create or replace function public.get_manager_free_agent_offers_for_user(
  p_user_id uuid,
  p_world_id text,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  club_id_value text;
  result_value jsonb;
begin
  select appointment.club_id into club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if club_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  select coalesce(jsonb_agg(to_jsonb(row_value) order by row_value.updated_at desc), '[]'::jsonb)
    into result_value
  from (
    select * from public.free_agent_offers
    where world_id = p_world_id and club_id = club_id_value
    order by updated_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) row_value;

  return result_value;
end;
$$;

create or replace function public.get_manager_free_agent_offer_history_for_user(
  p_user_id uuid,
  p_world_id text,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  club_id_value text;
  result_value jsonb;
begin
  select appointment.club_id into club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if club_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', offer.id,
    'free_agent_offer_id', offer.id,
    'acquisition_type', 'free_agent_offer',
    'status', offer.status,
    'revision_no', 1,
    'player_id', offer.player_id,
    'player_name', offer.player_name,
    'buyer_club_id', offer.club_id,
    'buyer_club_name', offer.club_id,
    'seller_club_id', null,
    'seller_club_name', 'Free agent',
    'direction', 'incoming',
    'counterpart_club_id', null,
    'counterpart_club_name', 'Free agent',
    'fee', 0,
    'contract_years', offer.contract_years,
    'wage', offer.wage,
    'terminal_reason', offer.decision_reason,
    'settlement_error', case when offer.status = 'application_failed' then offer.decision_reason else null end,
    'created_at', offer.created_at,
    'updated_at', offer.updated_at,
    'terminal_at', offer.terminal_at
  ) order by coalesce(offer.terminal_at, offer.updated_at) desc), '[]'::jsonb)
  into result_value
  from (
    select * from public.free_agent_offers
    where world_id = p_world_id and club_id = club_id_value and status <> 'pending'
    order by coalesce(terminal_at, updated_at) desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) offer;

  return result_value;
end;
$$;

revoke all on function public.submit_free_agent_offer_for_user(uuid,text,text,text,text,jsonb,integer,bigint,text) from public, anon, authenticated;
grant execute on function public.submit_free_agent_offer_for_user(uuid,text,text,text,text,jsonb,integer,bigint,text) to service_role;
revoke all on function public.get_manager_free_agent_offers_for_user(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.get_manager_free_agent_offers_for_user(uuid,text,integer) to service_role;
revoke all on function public.get_manager_free_agent_offer_history_for_user(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.get_manager_free_agent_offer_history_for_user(uuid,text,integer) to service_role;

commit;
