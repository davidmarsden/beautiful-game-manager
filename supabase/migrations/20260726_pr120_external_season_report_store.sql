create table if not exists public.season_match_report_bundles (
  world_id text not null,
  report_store_key text not null,
  season_id text not null,
  reports jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (world_id, report_store_key),
  constraint season_match_report_bundles_reports_array check (jsonb_typeof(reports) = 'array')
);

create index if not exists season_match_report_bundles_world_season_idx
  on public.season_match_report_bundles (world_id, season_id desc);

alter table public.season_match_report_bundles enable row level security;

revoke all on public.season_match_report_bundles from anon;
grant select on public.season_match_report_bundles to authenticated;

create policy "appointed managers can read world season reports"
  on public.season_match_report_bundles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.manager_profiles mp
      join public.manager_appointments ma on ma.manager_id = mp.id
      where mp.user_id = auth.uid()
        and ma.status = 'active'
        and ma.world_id = season_match_report_bundles.world_id
    )
  );

create or replace function public.persist_season_match_report_bundle(
  p_world_id text,
  p_report_store_key text,
  p_season_id text,
  p_reports jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  if jsonb_typeof(p_reports) <> 'array' then
    raise exception 'reports must be a JSON array';
  end if;
  insert into public.season_match_report_bundles (world_id, report_store_key, season_id, reports)
  values (p_world_id, p_report_store_key, p_season_id, p_reports)
  on conflict (world_id, report_store_key) do update
    set season_id = excluded.season_id,
        reports = excluded.reports;
end;
$$;

revoke all on function public.persist_season_match_report_bundle(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.persist_season_match_report_bundle(text, text, text, jsonb) to service_role;
