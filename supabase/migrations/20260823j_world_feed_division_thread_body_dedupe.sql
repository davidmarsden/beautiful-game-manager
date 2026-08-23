-- Follow-up to the division-thread sync: the initial aggregation expands each
-- fixture once per participating club while collecting club IDs. Keep the club
-- membership metadata, but normalise the human-facing fixture/result lines.

begin;

alter function public.sync_world_feed_system_items(text)
  rename to sync_world_feed_system_items_division_raw;

revoke all on function public.sync_world_feed_system_items_division_raw(text) from public, anon, authenticated;
grant execute on function public.sync_world_feed_system_items_division_raw(text) to service_role;

create or replace function public.sync_world_feed_system_items(p_world_id text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  changed_count integer;
begin
  changed_count := public.sync_world_feed_system_items_division_raw(p_world_id);

  with cleaned as (
    select
      item.id,
      coalesce((
        select string_agg(distinct line, E'\n' order by line)
        from regexp_split_to_table(split_part(item.body, E'\n\n', 1), E'\n') line
        where trim(line) <> ''
      ), '') as lines,
      split_part(item.body, E'\n\n', 2) as prompt
    from public.world_feed_items item
    where item.world_id = p_world_id
      and item.metadata->>'thread_scope' = 'division'
      and item.item_type in ('matchday_completed', 'matchday_press_conference')
  )
  update public.world_feed_items item
  set body = cleaned.lines || E'\n\n' || cleaned.prompt
  from cleaned
  where item.id = cleaned.id
    and cleaned.lines <> ''
    and cleaned.prompt <> ''
    and item.body is distinct from cleaned.lines || E'\n\n' || cleaned.prompt;

  return changed_count;
end;
$$;

revoke all on function public.sync_world_feed_system_items(text) from public, anon, authenticated;
grant execute on function public.sync_world_feed_system_items(text) to service_role;

-- Normalise rows produced by the preceding migration immediately.
do $$
declare
  world_row record;
begin
  for world_row in select world_id from public.canonical_world_saves loop
    perform public.sync_world_feed_system_items(world_row.world_id);
  end loop;
end;
$$;

commit;
