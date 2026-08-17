create table if not exists public.world_read_model_cache (
  world_id text primary key references public.canonical_world_saves(world_id) on delete cascade,
  source_checksum text not null,
  read_model jsonb not null,
  refreshed_at timestamptz not null default now()
);

create index if not exists world_read_model_cache_source_checksum_idx
  on public.world_read_model_cache (source_checksum);

alter table public.world_read_model_cache enable row level security;

revoke all on table public.world_read_model_cache from anon, authenticated;
grant select, insert, update, delete on table public.world_read_model_cache to service_role;

create or replace function public.get_world_player_identity_directory(p_world_id text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(read_model #> '{squad_cycle,players}', '{}'::jsonb)
  from public.world_read_model_cache
  where world_id = p_world_id
  limit 1
$$;

revoke all on function public.get_world_player_identity_directory(text) from public, anon, authenticated;
grant execute on function public.get_world_player_identity_directory(text) to service_role;
