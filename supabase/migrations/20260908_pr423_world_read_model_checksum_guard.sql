-- PR #423 follow-up: prevent a post-commit projector for checksum A from
-- overwriting a newer checksum B read model if another canonical writer wins
-- the race between archive projection and cache refresh.

create or replace function public.guard_world_read_model_cache_checksum()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  current_checksum text;
begin
  select save_checksum
    into current_checksum
    from public.canonical_world_saves
   where world_id = new.world_id;

  if current_checksum is null or new.source_checksum is distinct from current_checksum then
    if tg_op = 'UPDATE' then
      return old;
    end if;
    return null;
  end if;

  return new;
end;
$function$;

drop trigger if exists world_read_model_cache_checksum_guard
  on public.world_read_model_cache;

create trigger world_read_model_cache_checksum_guard
before insert or update on public.world_read_model_cache
for each row execute function public.guard_world_read_model_cache_checksum();

revoke all on function public.guard_world_read_model_cache_checksum() from public, anon, authenticated;
grant execute on function public.guard_world_read_model_cache_checksum() to service_role;
