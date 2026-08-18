-- #240: first-class multiplayer transfer deal foundation.
-- Negotiation/listing state lives outside the matchday manager-command queue.

begin;

create table if not exists public.transfer_market_listings (
  id uuid primary key default gen_random_uuid(),
  world_id text not null references public.canonical_world_saves(world_id) on delete cascade,
  player_id text not null,
  club_id text not null,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  asking_fee numeric not null default 0 check (asking_fee >= 0),
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  withdrawn_at timestamptz
);

create unique index if not exists transfer_market_one_active_listing_per_player_idx
  on public.transfer_market_listings(world_id, player_id)
  where status = 'active';
create index if not exists transfer_market_listings_world_status_idx
  on public.transfer_market_listings(world_id, status, updated_at desc);
create index if not exists transfer_market_listings_club_status_idx
  on public.transfer_market_listings(world_id, club_id, status, updated_at desc);

create table if not exists public.transfer_market_listing_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.transfer_market_listings(id) on delete cascade,
  world_id text not null,
  player_id text not null,
  club_id text not null,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  event_type text not null check (event_type in ('listed', 'updated', 'withdrawn')),
  asking_fee numeric not null default 0 check (asking_fee >= 0),
  request_key text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(world_id, manager_id, request_key)
);

create index if not exists transfer_market_listing_events_listing_idx
  on public.transfer_market_listing_events(listing_id, created_at asc);

-- Deal records are created in later #240 slices; the schema lands now so listing,
-- negotiation and settlement have a stable first-class destination rather than
-- extending manager_world_commands further.
create table if not exists public.transfer_deals (
  id uuid primary key default gen_random_uuid(),
  world_id text not null references public.canonical_world_saves(world_id) on delete cascade,
  listing_id uuid references public.transfer_market_listings(id) on delete set null,
  created_by_manager_id uuid not null references public.manager_profiles(id) on delete restrict,
  status text not null default 'negotiating' check (status in (
    'negotiating', 'agreed', 'grace_period', 'binding', 'settling', 'completed',
    'declined', 'withdrawn', 'cancelled_in_grace', 'mutually_cancelled',
    'expired', 'application_failed', 'reneged'
  )),
  current_revision_no integer not null default 0 check (current_revision_no >= 0),
  grace_expires_at timestamptz,
  binding_at timestamptz,
  settle_at timestamptz,
  terminal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal_at timestamptz
);

create index if not exists transfer_deals_world_status_idx
  on public.transfer_deals(world_id, status, updated_at desc);

create table if not exists public.transfer_deal_revisions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.transfer_deals(id) on delete cascade,
  revision_no integer not null check (revision_no > 0),
  created_by_manager_id uuid not null references public.manager_profiles(id) on delete restrict,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(deal_id, revision_no)
);

create table if not exists public.transfer_deal_participants (
  deal_id uuid not null references public.transfer_deals(id) on delete cascade,
  club_id text not null,
  manager_id uuid references public.manager_profiles(id) on delete set null,
  role text not null default 'participant' check (role in ('buyer', 'seller', 'participant')),
  joined_at timestamptz not null default now(),
  primary key(deal_id, club_id)
);

create table if not exists public.transfer_deal_legs (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.transfer_deal_revisions(id) on delete cascade,
  sequence_no integer not null check (sequence_no > 0),
  leg_type text not null check (leg_type in ('cash', 'permanent_transfer', 'loan')),
  from_club_id text,
  to_club_id text,
  player_id text,
  amount numeric check (amount is null or amount >= 0),
  terms jsonb not null default '{}'::jsonb,
  unique(revision_id, sequence_no),
  check (from_club_id is not null or to_club_id is not null),
  check (
    (leg_type = 'cash' and amount is not null and from_club_id is not null and to_club_id is not null)
    or
    (leg_type in ('permanent_transfer', 'loan') and player_id is not null and from_club_id is not null and to_club_id is not null)
  )
);

create table if not exists public.transfer_deal_approvals (
  revision_id uuid not null references public.transfer_deal_revisions(id) on delete cascade,
  club_id text not null,
  manager_id uuid not null references public.manager_profiles(id) on delete restrict,
  decision text not null check (decision in ('approved', 'declined')),
  decided_at timestamptz not null default now(),
  primary key(revision_id, club_id)
);

alter table public.transfer_market_listings enable row level security;
alter table public.transfer_market_listing_events enable row level security;
alter table public.transfer_deals enable row level security;
alter table public.transfer_deal_revisions enable row level security;
alter table public.transfer_deal_participants enable row level security;
alter table public.transfer_deal_legs enable row level security;
alter table public.transfer_deal_approvals enable row level security;

revoke all on table public.transfer_market_listings from anon, authenticated;
revoke all on table public.transfer_market_listing_events from anon, authenticated;
revoke all on table public.transfer_deals from anon, authenticated;
revoke all on table public.transfer_deal_revisions from anon, authenticated;
revoke all on table public.transfer_deal_participants from anon, authenticated;
revoke all on table public.transfer_deal_legs from anon, authenticated;
revoke all on table public.transfer_deal_approvals from anon, authenticated;

grant select, insert, update, delete on table public.transfer_market_listings to service_role;
grant select, insert on table public.transfer_market_listing_events to service_role;
grant select, insert, update, delete on table public.transfer_deals to service_role;
grant select, insert, update, delete on table public.transfer_deal_revisions to service_role;
grant select, insert, update, delete on table public.transfer_deal_participants to service_role;
grant select, insert, update, delete on table public.transfer_deal_legs to service_role;
grant select, insert, update, delete on table public.transfer_deal_approvals to service_role;

create or replace function public.get_manager_transfer_market_for_user(
  p_user_id uuid,
  p_world_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  cache_row public.world_read_model_cache;
  canonical_checksum text;
  listings_value jsonb;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;

  select profile.id, appointment.club_id
    into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;

  if manager_id_value is null then
    raise exception 'No active manager appointment for this user and world';
  end if;

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

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'listing_id', listing.id,
      'player_id', listing.player_id,
      'player_name', coalesce(
        cache_row.read_model #>> array['squad_cycle','players',listing.player_id,'display_name'],
        cache_row.read_model #>> array['squad_cycle','players',listing.player_id,'player_name'],
        listing.player_id
      ),
      'club_id', listing.club_id,
      'asking_fee', listing.asking_fee,
      'status', listing.status,
      'created_at', listing.created_at,
      'updated_at', listing.updated_at,
      'is_own_listing', listing.club_id = club_id_value
    ) order by listing.updated_at desc
  ), '[]'::jsonb)
  into listings_value
  from public.transfer_market_listings listing
  where listing.world_id = p_world_id
    and listing.status = 'active';

  return jsonb_build_object(
    'world_id', p_world_id,
    'club_id', club_id_value,
    'listings', listings_value
  );
end;
$$;

create or replace function public.set_manager_transfer_listing_for_user(
  p_user_id uuid,
  p_world_id text,
  p_player_id text,
  p_action text,
  p_asking_fee numeric,
  p_request_key text
) returns public.transfer_market_listings
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  cache_row public.world_read_model_cache;
  canonical_checksum text;
  player_value jsonb;
  existing_event public.transfer_market_listing_events;
  listing_row public.transfer_market_listings;
  action_value text := lower(trim(coalesce(p_action, '')));
  fee_value numeric := greatest(coalesce(p_asking_fee, 0), 0);
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;
  if trim(coalesce(p_player_id, '')) = '' then raise exception 'Player is required'; end if;
  if action_value not in ('list', 'withdraw') then raise exception 'Listing action must be list or withdraw'; end if;
  if trim(coalesce(p_request_key, '')) = '' then raise exception 'Request key is required'; end if;

  select profile.id, appointment.club_id
    into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;

  if manager_id_value is null then
    raise exception 'No active manager appointment for this user and world';
  end if;

  select * into existing_event
  from public.transfer_market_listing_events event
  where event.world_id = p_world_id
    and event.manager_id = manager_id_value
    and event.request_key = p_request_key
  limit 1;

  if existing_event.id is not null then
    select * into listing_row from public.transfer_market_listings where id = existing_event.listing_id;
    return listing_row;
  end if;

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

  player_value := cache_row.read_model #> array['squad_cycle','players',p_player_id];
  if player_value is null then raise exception 'Player is not present in the canonical world'; end if;
  if coalesce(player_value->>'club_id', '') <> club_id_value then
    raise exception 'Only a player owned by the appointed club can be listed or withdrawn';
  end if;

  select * into listing_row
  from public.transfer_market_listings listing
  where listing.world_id = p_world_id
    and listing.player_id = p_player_id
    and listing.status = 'active'
  for update;

  if action_value = 'list' then
    if listing_row.id is null then
      insert into public.transfer_market_listings (
        world_id, player_id, club_id, manager_id, asking_fee, status
      ) values (
        p_world_id, p_player_id, club_id_value, manager_id_value, fee_value, 'active'
      ) returning * into listing_row;

      insert into public.transfer_market_listing_events (
        listing_id, world_id, player_id, club_id, manager_id, event_type, asking_fee, request_key
      ) values (
        listing_row.id, p_world_id, p_player_id, club_id_value, manager_id_value,
        'listed', fee_value, p_request_key
      );
    else
      update public.transfer_market_listings
      set asking_fee = fee_value,
          updated_at = now()
      where id = listing_row.id
      returning * into listing_row;

      insert into public.transfer_market_listing_events (
        listing_id, world_id, player_id, club_id, manager_id, event_type, asking_fee, request_key
      ) values (
        listing_row.id, p_world_id, p_player_id, club_id_value, manager_id_value,
        'updated', fee_value, p_request_key
      );
    end if;

    return listing_row;
  end if;

  if listing_row.id is null then
    raise exception 'Player does not have an active transfer listing';
  end if;

  update public.transfer_market_listings
  set status = 'withdrawn',
      withdrawn_at = now(),
      updated_at = now()
  where id = listing_row.id
  returning * into listing_row;

  insert into public.transfer_market_listing_events (
    listing_id, world_id, player_id, club_id, manager_id, event_type, asking_fee, request_key
  ) values (
    listing_row.id, p_world_id, p_player_id, club_id_value, manager_id_value,
    'withdrawn', listing_row.asking_fee, p_request_key
  );

  return listing_row;
end;
$$;

revoke all on function public.get_manager_transfer_market_for_user(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_manager_transfer_market_for_user(uuid, text)
  to service_role;

revoke all on function public.set_manager_transfer_listing_for_user(uuid, text, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.set_manager_transfer_listing_for_user(uuid, text, text, text, numeric, text)
  to service_role;

do $security_assertions$
begin
  if has_table_privilege('authenticated', 'public.transfer_market_listings', 'select') then
    raise exception 'authenticated can read transfer listings directly';
  end if;
  if has_table_privilege('authenticated', 'public.transfer_deals', 'select') then
    raise exception 'authenticated can read transfer deals directly';
  end if;
  if has_function_privilege('authenticated',
    'public.get_manager_transfer_market_for_user(uuid,text)', 'execute') then
    raise exception 'authenticated can execute transfer-market gateway directly';
  end if;
  if not has_function_privilege('service_role',
    'public.set_manager_transfer_listing_for_user(uuid,text,text,text,numeric,text)', 'execute') then
    raise exception 'service_role lost transfer-listing gateway access';
  end if;
end
$security_assertions$;

commit;
