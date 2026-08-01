-- match_runs is internal engine state. Ordinary API roles have no table grants,
-- and this explicit false policy documents the deny-all RLS contract while
-- preventing future accidental grants from exposing rows.

begin;

drop policy if exists "deny ordinary access to match runs"
  on public.match_runs;

create policy "deny ordinary access to match runs"
  on public.match_runs
  for all
  to anon, authenticated
  using (false)
  with check (false);

commit;
