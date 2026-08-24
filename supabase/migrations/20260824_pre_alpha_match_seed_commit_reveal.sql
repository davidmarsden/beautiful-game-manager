begin;

alter table public.match_runs
  add column if not exists seed_nonce text,
  add column if not exists seed_commitment text,
  add column if not exists seed_committed_at timestamptz;

alter table public.fixtures
  add column if not exists match_seed_commitment text,
  add column if not exists match_seed_committed_at timestamptz,
  add column if not exists match_seed_reveal text,
  add column if not exists match_seed_revealed_at timestamptz;

comment on column public.match_runs.seed_nonce is
  'Private per-fixture entropy. Service-role only; never expose before full-time.';
comment on column public.match_runs.seed_commitment is
  'SHA-256 commitment to the exact engine seed used for this fixture.';
comment on column public.fixtures.match_seed_commitment is
  'Public-safe commitment to the fixture seed, persisted before engine resolution.';
comment on column public.fixtures.match_seed_reveal is
  'Exact fixture seed revealed only after successful finalisation.';

alter table public.match_runs
  add constraint match_runs_seed_commitment_hex
  check (seed_commitment is null or seed_commitment ~ '^[0-9a-f]{64}$') not valid;

alter table public.fixtures
  add constraint fixtures_seed_commitment_hex
  check (match_seed_commitment is null or match_seed_commitment ~ '^[0-9a-f]{64}$') not valid;

commit;
