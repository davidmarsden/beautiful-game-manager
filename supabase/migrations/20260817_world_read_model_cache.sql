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
