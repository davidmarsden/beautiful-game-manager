-- PR #101: repair legacy terminal command rows created before PR #100 persisted outcome reasons.

update public.manager_world_commands
set
  outcome_reason = case status
    when 'applied' then 'Request applied at its shared-world checkpoint.'
    when 'rejected' then 'Request was rejected during shared-world processing.'
    when 'cancelled' then 'Request was cancelled before application.'
    when 'superseded' then 'Request was replaced by a newer request.'
    else outcome_reason
  end,
  outcome_details = coalesce(outcome_details, '{}'::jsonb) || jsonb_build_object(
    'source', 'legacy_outcome_backfill',
    'backfilled_at', now()
  )
where status in ('applied', 'rejected', 'cancelled', 'superseded')
  and (outcome_reason is null or btrim(outcome_reason) = '');
