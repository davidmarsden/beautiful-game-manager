alter table public.worlds
  add column if not exists archive_mode boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

create or replace function public.tbg_reject_archived_world_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_world_id text;
begin
  v_world_id := coalesce(
    case when tg_op <> 'DELETE' then to_jsonb(new)->>'world_id' end,
    case when tg_op <> 'INSERT' then to_jsonb(old)->>'world_id' end
  );

  if v_world_id is not null
     and exists (
       select 1 from public.worlds w
       where w.id = v_world_id and w.archive_mode = true
     )
  then
    raise exception 'world_archived_read_only' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'manager_submissions',
    'manager_turn_submissions',
    'manager_world_commands',
    'manager_world_activity',
    'team_sheet_presets',
    'transfer_listings',
    'transfer_bids',
    'transfer_deals',
    'free_agent_offers',
    'player_acquisitions',
    'manager_shortlist',
    'manager_player_shortlists',
    'conversation_messages',
    'world_feed_items',
    'world_feed_comments'
  ]
  loop
    if to_regclass('public.' || t) is not null
       and exists (
         select 1 from information_schema.columns
         where table_schema='public' and table_name=t and column_name='world_id'
       )
    then
      execute format('drop trigger if exists tbg_archive_read_only on public.%I', t);
      execute format(
        'create trigger tbg_archive_read_only before insert or update or delete on public.%I for each row execute function public.tbg_reject_archived_world_write()',
        t
      );
    end if;
  end loop;
end $$;
