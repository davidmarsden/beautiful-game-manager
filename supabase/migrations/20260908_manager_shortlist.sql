begin;

create table if not exists public.manager_shortlist (
  id uuid primary key default gen_random_uuid(),
  world_id text not null references public.worlds(id) on delete cascade,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  player_id text not null,
  source_type text not null default 'unknown' check (source_type in ('listed','free_agent','external','profile','unknown')),
  player_snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(world_id, manager_id, player_id)
);

create index if not exists manager_shortlist_manager_created_idx
  on public.manager_shortlist(world_id, manager_id, created_at desc);

alter table public.manager_shortlist enable row level security;

create or replace function public.get_manager_shortlist_for_user(
  p_user_id uuid,
  p_world_id text default 'tbg-world-1'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_manager_id uuid;
  v_items jsonb;
begin
  select id into v_manager_id
  from public.manager_profiles
  where user_id = p_user_id and status = 'active'
  limit 1;

  if v_manager_id is null then
    return jsonb_build_object('ok', false, 'code', 'manager_profile_missing');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select id, player_id, source_type, player_snapshot, note, created_at, updated_at
    from public.manager_shortlist
    where world_id = p_world_id and manager_id = v_manager_id
    order by created_at desc
  ) x;

  return jsonb_build_object('ok', true, 'items', v_items);
end;
$$;

create or replace function public.upsert_manager_shortlist_for_user(
  p_user_id uuid,
  p_world_id text,
  p_player_id text,
  p_source_type text default 'unknown',
  p_player_snapshot jsonb default '{}'::jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_manager_id uuid;
  v_id uuid;
  v_source text;
begin
  select id into v_manager_id
  from public.manager_profiles
  where user_id = p_user_id and status = 'active'
  limit 1;

  if v_manager_id is null then
    return jsonb_build_object('ok', false, 'code', 'manager_profile_missing');
  end if;

  if nullif(trim(p_player_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'player_id_required');
  end if;

  if coalesce(length(p_note), 0) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'note_too_long');
  end if;

  v_source := case
    when p_source_type in ('listed','free_agent','external','profile','unknown') then p_source_type
    else 'unknown'
  end;

  insert into public.manager_shortlist (
    world_id, manager_id, player_id, source_type, player_snapshot, note
  ) values (
    p_world_id,
    v_manager_id,
    trim(p_player_id),
    v_source,
    coalesce(p_player_snapshot, '{}'::jsonb),
    nullif(trim(p_note), '')
  )
  on conflict (world_id, manager_id, player_id)
  do update set
    source_type = excluded.source_type,
    player_snapshot = case
      when excluded.player_snapshot = '{}'::jsonb then public.manager_shortlist.player_snapshot
      else excluded.player_snapshot
    end,
    note = case
      when p_note is null then public.manager_shortlist.note
      else nullif(trim(p_note), '')
    end,
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'player_id', trim(p_player_id));
end;
$$;

create or replace function public.remove_manager_shortlist_for_user(
  p_user_id uuid,
  p_world_id text,
  p_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_manager_id uuid;
begin
  select id into v_manager_id
  from public.manager_profiles
  where user_id = p_user_id and status = 'active'
  limit 1;

  if v_manager_id is null then
    return jsonb_build_object('ok', false, 'code', 'manager_profile_missing');
  end if;

  delete from public.manager_shortlist
  where world_id = p_world_id
    and manager_id = v_manager_id
    and player_id = trim(p_player_id);

  return jsonb_build_object('ok', true, 'player_id', trim(p_player_id));
end;
$$;

revoke all on table public.manager_shortlist from public, anon, authenticated;
revoke all on function public.get_manager_shortlist_for_user(uuid,text) from public, anon, authenticated;
revoke all on function public.upsert_manager_shortlist_for_user(uuid,text,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.remove_manager_shortlist_for_user(uuid,text,text) from public, anon, authenticated;

grant execute on function public.get_manager_shortlist_for_user(uuid,text) to service_role;
grant execute on function public.upsert_manager_shortlist_for_user(uuid,text,text,text,jsonb,text) to service_role;
grant execute on function public.remove_manager_shortlist_for_user(uuid,text,text) to service_role;

commit;
