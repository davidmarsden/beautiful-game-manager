-- #330: private negotiation, public agreement.
-- Accepted first-class transfer packages become visible to every active manager in
-- the same world. Integrity reports remain private service-role/admin state and
-- never mutate transfer lifecycle state.

begin;

create table if not exists public.transfer_integrity_reports (
  id uuid primary key default gen_random_uuid(),
  world_id text not null,
  deal_id uuid not null references public.transfer_deals(id) on delete cascade,
  reporter_manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  reason text not null,
  note text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  resolution_note text,
  constraint transfer_integrity_reports_reason_check check (reason in (
    'suspected_collusion_multi_accounting',
    'deliberate_club_wrecking',
    'repeated_one_sided_dealing',
    'rules_circumvention',
    'other_competitive_integrity'
  )),
  constraint transfer_integrity_reports_status_check check (status in ('open','reviewing','resolved','dismissed')),
  constraint transfer_integrity_reports_note_length_check check (note is null or char_length(note) <= 2000),
  constraint transfer_integrity_reports_unique_reporter_deal unique (deal_id, reporter_manager_id)
);

alter table public.transfer_integrity_reports enable row level security;
revoke all on table public.transfer_integrity_reports from public, anon, authenticated;
grant select, insert, update, delete on table public.transfer_integrity_reports to service_role;

create index if not exists transfer_integrity_reports_world_status_idx
  on public.transfer_integrity_reports(world_id, status, created_at desc);
create index if not exists transfer_integrity_reports_deal_idx
  on public.transfer_integrity_reports(deal_id, created_at desc);

comment on table public.transfer_integrity_reports is
  'Private competitive-integrity reports about publicly accepted transfer deals. Reports never alter transfer lifecycle state automatically.';

create or replace function public.get_world_transfer_register_for_user(
  p_user_id uuid,
  p_world_id text,
  p_limit integer default 100
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  cache_row public.world_read_model_cache;
  canonical_checksum text;
  result_value jsonb;
begin
  select profile.id into manager_id_value
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
  from public.canonical_world_saves where world_id = p_world_id limit 1;
  select * into cache_row
  from public.world_read_model_cache where world_id = p_world_id limit 1;
  if cache_row.read_model is null or canonical_checksum is null or cache_row.source_checksum <> canonical_checksum then
    raise exception 'World read model is refreshing; please retry shortly';
  end if;

  with visible_deals as (
    select
      deal.id,
      deal.status,
      deal.current_revision_no,
      deal.created_at,
      deal.updated_at,
      -- Agreement time must remain stable after later lifecycle updates mutate
      -- updated_at. grace_expires_at is the retained end of the agreement cooling
      -- clock, so subtract the public cooling duration to recover acceptance time.
      deal.grace_expires_at - make_interval(mins => coalesce(deal.integrity_cooling_minutes, 15)) as agreed_at,
      deal.grace_expires_at,
      deal.binding_at,
      deal.settle_at,
      deal.terminal_at,
      deal.terminal_reason,
      deal.integrity_level,
      deal.integrity_reasons,
      deal.integrity_cooling_minutes,
      revision.id as revision_id
    from public.transfer_deals deal
    join public.transfer_deal_revisions revision
      on revision.deal_id = deal.id
     and revision.revision_no = deal.current_revision_no
    where deal.world_id = p_world_id
      -- `grace_expires_at` is only created when both participants accept an exact
      -- revision. This preserves private negotiation while retaining later
      -- cancelled/failed accepted deals in the transparent public record.
      and deal.grace_expires_at is not null
    order by coalesce(deal.terminal_at, deal.updated_at) desc
    limit greatest(1, least(coalesce(p_limit, 100), 200))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', deal.id,
    'status', deal.status,
    'effective_state', case
      when deal.status = 'agreed' and now() < deal.grace_expires_at then 'grace_period'
      when deal.status = 'agreed' then 'binding'
      else deal.status
    end,
    'revision_no', deal.current_revision_no,
    'agreed_at', deal.agreed_at,
    'grace_expires_at', deal.grace_expires_at,
    'binding_at', deal.binding_at,
    'settle_at', deal.settle_at,
    'terminal_at', deal.terminal_at,
    'terminal_reason', deal.terminal_reason,
    'integrity_level', deal.integrity_level,
    'integrity_reasons', deal.integrity_reasons,
    'integrity_cooling_minutes', deal.integrity_cooling_minutes,
    'already_reported_by_me', exists (
      select 1 from public.transfer_integrity_reports report
      where report.deal_id = deal.id and report.reporter_manager_id = manager_id_value
    ),
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sequence_no', leg.sequence_no,
        'leg_type', leg.leg_type,
        'from_club_id', leg.from_club_id,
        'from_club_name', coalesce(
          cache_row.read_model #>> array['club_profiles',leg.from_club_id,'club_name'],
          cache_row.read_model #>> array['club_profiles',leg.from_club_id,'canonical_name'],
          leg.from_club_id
        ),
        'to_club_id', leg.to_club_id,
        'to_club_name', coalesce(
          cache_row.read_model #>> array['club_profiles',leg.to_club_id,'club_name'],
          cache_row.read_model #>> array['club_profiles',leg.to_club_id,'canonical_name'],
          leg.to_club_id
        ),
        'player_id', leg.player_id,
        'player_name', case when leg.player_id is null then null else coalesce(
          cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'display_name'],
          cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'player_name'],
          leg.player_id
        ) end,
        'amount', leg.amount,
        'contract_years', case
          when coalesce(leg.terms->>'contract_years','') ~ '^[0-9]+$'
          then greatest(1, least((leg.terms->>'contract_years')::integer, 5))
          else null end
      ) order by leg.sequence_no)
      from public.transfer_deal_legs leg
      where leg.revision_id = deal.revision_id
    ), '[]'::jsonb)
  ) order by coalesce(deal.terminal_at, deal.updated_at) desc), '[]'::jsonb)
  into result_value
  from visible_deals deal;

  return result_value;
end;
$$;

create or replace function public.submit_transfer_integrity_report_for_user(
  p_user_id uuid,
  p_world_id text,
  p_deal_id uuid,
  p_reason text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  deal_value public.transfer_deals;
  report_id_value uuid;
begin
  select profile.id into manager_id_value
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

  if p_reason not in (
    'suspected_collusion_multi_accounting',
    'deliberate_club_wrecking',
    'repeated_one_sided_dealing',
    'rules_circumvention',
    'other_competitive_integrity'
  ) then
    raise exception 'Invalid transfer integrity report reason';
  end if;
  if char_length(coalesce(p_note,'')) > 2000 then
    raise exception 'Transfer integrity report note is too long';
  end if;

  select * into deal_value
  from public.transfer_deals
  where id = p_deal_id and world_id = p_world_id
  limit 1;
  if deal_value.id is null or deal_value.grace_expires_at is null then
    raise exception 'Only publicly accepted transfer deals can be reported';
  end if;

  insert into public.transfer_integrity_reports(world_id, deal_id, reporter_manager_id, reason, note)
  values (p_world_id, p_deal_id, manager_id_value, p_reason, nullif(trim(coalesce(p_note,'')),''))
  on conflict (deal_id, reporter_manager_id) do nothing
  returning id into report_id_value;

  if report_id_value is null then
    raise exception 'You have already reported this transfer';
  end if;

  -- Deliberately no UPDATE/DELETE against transfer_deals or transfer lifecycle
  -- tables here. A report creates an admin-review record only.
  return jsonb_build_object(
    'report_id', report_id_value,
    'deal_id', p_deal_id,
    'status', 'open',
    'message', 'Transfer reported privately for competitive-integrity review.'
  );
end;
$$;

revoke all on function public.get_world_transfer_register_for_user(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.get_world_transfer_register_for_user(uuid,text,integer) to service_role;
revoke all on function public.submit_transfer_integrity_report_for_user(uuid,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.submit_transfer_integrity_report_for_user(uuid,text,uuid,text,text) to service_role;

commit;
