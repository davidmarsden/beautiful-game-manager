-- #240 production follow-up: a legacy settlement failure recovered by 19c must
-- retain the clock of the agreement it is recovering, rather than receiving a
-- new three-hour lifecycle from the recovery UPDATE itself.

begin;

with lifecycle as (
  select
    deal.id,
    deal.current_revision_no,
    max(event.created_at) filter (where event.event_type = 'application_failed') as failed_at,
    max(event.created_at) filter (
      where event.event_type in ('accepted', 'amended')
        and case
          when coalesce(event.details->>'revision_no', '') ~ '^[0-9]+$'
            then (event.details->>'revision_no')::integer = deal.current_revision_no
          else event.event_type = 'accepted' and deal.current_revision_no = 1
        end
    ) as agreement_at
  from public.transfer_deals deal
  join public.transfer_deal_events event on event.deal_id = deal.id
  where deal.status = 'agreed'
  group by deal.id, deal.current_revision_no
), recovered as (
  select
    id,
    agreement_at
  from lifecycle
  where failed_at is not null
    and agreement_at is not null
    -- A genuine new acceptance/amendment after a failure owns a fresh clock.
    -- The 19c recovery does not emit such an event, so its failure remains later
    -- than the agreement being recovered.
    and failed_at > agreement_at
)
update public.transfer_deals deal
set grace_expires_at = recovered.agreement_at + interval '15 minutes',
    binding_at = recovered.agreement_at + interval '15 minutes',
    settle_at = recovered.agreement_at + interval '3 hours'
from recovered
where deal.id = recovered.id;

commit;
