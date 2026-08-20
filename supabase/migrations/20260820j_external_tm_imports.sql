-- #240 Slice D: external Transfermarkt-ID resolution/import and acquisition provenance.

begin;

create table if not exists public.external_player_imports (
  id uuid primary key default gen_random_uuid(),
  transfermarkt_id text not null unique,
  status text not null default 'requested' check (status in ('requested','scraping','scraped','ready','failed')),
  requested_by_user_id uuid references auth.users(id) on delete set null,
  apify_run_id text,
  apify_dataset_id text,
  player_snapshot jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists external_player_imports_status_idx
  on public.external_player_imports(status, updated_at);

alter table public.external_player_imports enable row level security;
revoke all on public.external_player_imports from public, anon, authenticated;
grant select, insert, update on public.external_player_imports to service_role;

-- The existing CAS-safe signing path writes player_acquisitions. Preserve the
-- external-market distinction at that durable layer instead of relying only on
-- free-agent offer history. The existing schema vocabulary uses `external`.
create or replace function public.classify_player_acquisition_provenance()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if coalesce(new.player_snapshot->>'acquisition_type', '') = 'external_transfermarkt' then
    new.acquisition_type := 'external';
  end if;
  return new;
end;
$$;

drop trigger if exists player_acquisitions_classify_provenance on public.player_acquisitions;
create trigger player_acquisitions_classify_provenance
before insert or update of player_snapshot on public.player_acquisitions
for each row execute function public.classify_player_acquisition_provenance();

-- Keep one coherent transfer-history vocabulary. External-market contract offers reuse
-- the competitive player-decision ledger, but their snapshot carries the acquisition
-- provenance and deterministic market fee.
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
    'acquisition_type', case
      when offer.player_snapshot->>'acquisition_type' = 'external_transfermarkt' then 'external_transfermarkt_offer'
      else 'free_agent_offer'
    end,
    'status', offer.status,
    'revision_no', 1,
    'player_id', offer.player_id,
    'player_name', offer.player_name,
    'buyer_club_id', offer.club_id,
    'buyer_club_name', offer.club_id,
    'seller_club_id', null,
    'seller_club_name', case
      when offer.player_snapshot->>'acquisition_type' = 'external_transfermarkt' then coalesce(nullif(offer.player_snapshot->>'real_world_club',''), 'External market')
      else 'Free agent'
    end,
    'direction', 'incoming',
    'counterpart_club_id', null,
    'counterpart_club_name', case
      when offer.player_snapshot->>'acquisition_type' = 'external_transfermarkt' then 'External market'
      else 'Free agent'
    end,
    'fee', case
      when offer.player_snapshot->>'acquisition_type' = 'external_transfermarkt'
        then coalesce((offer.player_snapshot->>'external_acquisition_fee_eur')::bigint, 0)
      else 0
    end,
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

-- Accepted free-agent offer rows are deliberately filtered from transfer-history.mjs;
-- completed signings come from player_acquisitions. Project the same external-market
-- counterpart and fee here so successful deals do not lose provenance.
create or replace function public.get_manager_player_acquisition_history_for_user(
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
  manager_id_value uuid;
  club_id_value text;
  result_value jsonb;
begin
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', acquisition.id,
    'acquisition_id', acquisition.id,
    'acquisition_type', case
      when acquisition.acquisition_type = 'external' or acquisition.player_snapshot->>'acquisition_type' = 'external_transfermarkt'
        then 'external_transfermarkt'
      else acquisition.acquisition_type
    end,
    'status', acquisition.status,
    'revision_no', 1,
    'player_id', acquisition.player_id,
    'player_name', acquisition.player_name,
    'buyer_club_id', acquisition.club_id,
    'buyer_club_name', acquisition.club_id,
    'seller_club_id', null,
    'seller_club_name', case
      when acquisition.acquisition_type = 'external' or acquisition.player_snapshot->>'acquisition_type' = 'external_transfermarkt'
        then coalesce(nullif(acquisition.player_snapshot->>'real_world_club',''), 'External market')
      else 'Free agent'
    end,
    'direction', 'incoming',
    'counterpart_club_id', null,
    'counterpart_club_name', case
      when acquisition.acquisition_type = 'external' or acquisition.player_snapshot->>'acquisition_type' = 'external_transfermarkt'
        then 'External market'
      else 'Free agent'
    end,
    'fee', case
      when acquisition.acquisition_type = 'external' or acquisition.player_snapshot->>'acquisition_type' = 'external_transfermarkt'
        then coalesce((acquisition.player_snapshot->>'external_acquisition_fee_eur')::bigint, 0)
      else 0
    end,
    'contract_years', acquisition.contract_years,
    'wage', acquisition.wage,
    'terminal_reason', case
      when acquisition.status = 'completed' and (acquisition.acquisition_type = 'external' or acquisition.player_snapshot->>'acquisition_type' = 'external_transfermarkt') then 'external_player_acquired'
      when acquisition.status = 'completed' then 'free_agent_signed'
      else 'canonical_validation_failed'
    end,
    'settlement_error', acquisition.application_error,
    'created_at', acquisition.created_at,
    'updated_at', acquisition.updated_at,
    'terminal_at', acquisition.terminal_at
  ) order by coalesce(acquisition.terminal_at, acquisition.updated_at) desc), '[]'::jsonb)
  into result_value
  from (
    select * from public.player_acquisitions
    where world_id = p_world_id
      and club_id = club_id_value
      and status <> 'pending'
    order by coalesce(terminal_at, updated_at) desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) acquisition;

  return result_value;
end;
$$;

revoke all on function public.get_manager_free_agent_offer_history_for_user(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.get_manager_free_agent_offer_history_for_user(uuid,text,integer) to service_role;
revoke all on function public.get_manager_player_acquisition_history_for_user(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.get_manager_player_acquisition_history_for_user(uuid,text,integer) to service_role;

commit;
