-- #290 World Feed v0: durable public world activity outside the canonical checkpoint.
-- System events are idempotent projections of authoritative world/application state.

begin;

create table if not exists public.world_feed_items (
  id uuid primary key default gen_random_uuid(),
  world_id text not null,
  item_type text not null check (item_type in ('manager_post','manager_appointment','transfer_completed','matchday_upcoming','matchday_completed')),
  actor_manager_id uuid references public.manager_profiles(id) on delete set null,
  actor_club_id text,
  title text not null,
  body text not null default '',
  source_key text,
  related_club_id text,
  related_fixture_id text,
  related_deal_id uuid references public.transfer_deals(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by_manager_id uuid references public.manager_profiles(id) on delete set null,
  constraint world_feed_items_title_length check (char_length(title) between 1 and 160),
  constraint world_feed_items_body_length check (char_length(body) <= 4000)
);

create unique index if not exists world_feed_items_world_source_key_unique
  on public.world_feed_items(world_id, source_key)
  where source_key is not null;
create index if not exists world_feed_items_world_created_idx
  on public.world_feed_items(world_id, created_at desc, id desc);

create table if not exists public.world_feed_comments (
  id uuid primary key default gen_random_uuid(),
  feed_item_id uuid not null references public.world_feed_items(id) on delete cascade,
  manager_id uuid not null references public.manager_profiles(id) on delete restrict,
  club_id text not null,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  hidden_at timestamptz,
  hidden_by_manager_id uuid references public.manager_profiles(id) on delete set null,
  constraint world_feed_comments_body_length check (char_length(body) between 1 and 2000)
);

create index if not exists world_feed_comments_item_created_idx
  on public.world_feed_comments(feed_item_id, created_at asc, id asc);

alter table public.world_feed_items enable row level security;
alter table public.world_feed_comments enable row level security;
revoke all on public.world_feed_items from public, anon, authenticated;
revoke all on public.world_feed_comments from public, anon, authenticated;
grant select, insert, update on public.world_feed_items to service_role;
grant select, insert, update on public.world_feed_comments to service_role;

create or replace function public.sync_world_feed_system_items(p_world_id text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cache_row public.world_read_model_cache;
  canonical_row public.canonical_world_saves;
  inserted_count integer := 0;
  row_count_value integer := 0;
  previous_matchday integer;
begin
  if trim(coalesce(p_world_id, '')) = '' then raise exception 'World is required'; end if;

  select * into canonical_row from public.canonical_world_saves where world_id = p_world_id limit 1;
  select * into cache_row from public.world_read_model_cache where world_id = p_world_id limit 1;
  if canonical_row.world_id is null or cache_row.read_model is null or cache_row.source_checksum <> canonical_row.save_checksum then
    raise exception 'World read model is refreshing; please retry shortly';
  end if;

  -- Existing/current manager appointments become durable public world events.
  insert into public.world_feed_items(
    world_id, item_type, actor_manager_id, actor_club_id, title, body, source_key,
    related_club_id, metadata, created_at
  )
  select
    appointment.world_id,
    'manager_appointment',
    profile.id,
    appointment.club_id,
    'Manager appointed',
    profile.display_name || ' has taken charge of ' || coalesce(
      cache_row.read_model #>> array['club_profiles',appointment.club_id,'club_name'],
      cache_row.read_model #>> array['club_profiles',appointment.club_id,'canonical_name'],
      appointment.club_id
    ) || '.',
    'appointment:' || appointment.id::text,
    appointment.club_id,
    jsonb_build_object('appointment_id', appointment.id, 'control_type', appointment.control_type),
    coalesce(appointment.appointed_at, appointment.created_at)
  from public.manager_appointments appointment
  join public.manager_profiles profile on profile.id = appointment.manager_id
  where appointment.world_id = p_world_id
    and appointment.status = 'active'
  on conflict (world_id, source_key) where source_key is not null do nothing;
  get diagnostics row_count_value = row_count;
  inserted_count := inserted_count + row_count_value;

  -- Completed first-class transfers. Immutable revision legs are the source of truth.
  insert into public.world_feed_items(
    world_id, item_type, title, body, source_key, related_deal_id, metadata, created_at
  )
  select
    deal.world_id,
    'transfer_completed',
    case
      when leg_summary.player_count = 1 then 'Transfer completed: ' || leg_summary.primary_player_name
      else leg_summary.player_count::text || '-player deal completed'
    end,
    leg_summary.summary_text,
    'transfer:' || deal.id::text,
    deal.id,
    jsonb_build_object('deal_id', deal.id, 'revision_no', deal.current_revision_no, 'player_count', leg_summary.player_count),
    coalesce(deal.terminal_at, deal.updated_at)
  from public.transfer_deals deal
  join public.transfer_deal_revisions revision
    on revision.deal_id = deal.id and revision.revision_no = deal.current_revision_no
  cross join lateral (
    select
      count(*) filter (where leg.leg_type = 'permanent_transfer')::integer as player_count,
      coalesce(max(case when leg.leg_type = 'permanent_transfer' then coalesce(
        cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'display_name'],
        cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'player_name'],
        leg.player_id
      ) end), 'Transfer') as primary_player_name,
      string_agg(
        case
          when leg.leg_type = 'permanent_transfer' then
            coalesce(cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'display_name'], cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'player_name'], leg.player_id)
            || ': ' || coalesce(cache_row.read_model #>> array['club_profiles',leg.from_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',leg.from_club_id,'canonical_name'], leg.from_club_id)
            || ' → ' || coalesce(cache_row.read_model #>> array['club_profiles',leg.to_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',leg.to_club_id,'canonical_name'], leg.to_club_id)
          when leg.leg_type = 'cash' then
            '£' || trim(to_char(leg.amount, 'FM999,999,999,990.00'))
            || ': ' || coalesce(cache_row.read_model #>> array['club_profiles',leg.from_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',leg.from_club_id,'canonical_name'], leg.from_club_id)
            || ' → ' || coalesce(cache_row.read_model #>> array['club_profiles',leg.to_club_id,'club_name'], cache_row.read_model #>> array['club_profiles',leg.to_club_id,'canonical_name'], leg.to_club_id)
          else null
        end,
        E'\n' order by leg.sequence_no
      ) filter (where leg.leg_type in ('permanent_transfer','cash')) as summary_text
    from public.transfer_deal_legs leg
    where leg.revision_id = revision.id
  ) leg_summary
  where deal.world_id = p_world_id
    and deal.status = 'completed'
    and leg_summary.player_count > 0
  on conflict (world_id, source_key) where source_key is not null do nothing;
  get diagnostics row_count_value = row_count;
  inserted_count := inserted_count + row_count_value;

  -- Current matchday announcement. Source key makes refreshes/retries harmless.
  if canonical_row.matchday is not null then
    insert into public.world_feed_items(
      world_id, item_type, title, body, source_key, metadata, created_at
    ) values (
      p_world_id,
      'matchday_upcoming',
      'Matchday ' || canonical_row.matchday::text || ' is coming up',
      case when canonical_row.next_turn_at is null then 'Teams should be submitted before the next turn.'
           else 'Next turn: ' || to_char(canonical_row.next_turn_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC.' end,
      'matchday_upcoming:' || canonical_row.matchday::text,
      jsonb_build_object('matchday', canonical_row.matchday, 'next_turn_at', canonical_row.next_turn_at),
      least(now(), coalesce(canonical_row.updated_at, now()))
    )
    on conflict (world_id, source_key) where source_key is not null do nothing;
    get diagnostics row_count_value = row_count;
    inserted_count := inserted_count + row_count_value;
  end if;

  -- When the canonical world has advanced, publish the previous matchday once.
  previous_matchday := coalesce(canonical_row.matchday, 1) - 1;
  if previous_matchday >= 1 and exists (
    select 1
    from jsonb_each(coalesce(cache_row.read_model #> '{matchday_cycle,runtimes}', '{}'::jsonb)) runtime
    cross join lateral jsonb_array_elements(coalesce(runtime.value->'results', '[]'::jsonb) || coalesce(runtime.value->'archive_results', '[]'::jsonb)) result
    where coalesce(result.value #>> '{fixture,matchday}', '') = previous_matchday::text
  ) then
    insert into public.world_feed_items(
      world_id, item_type, title, body, source_key, metadata, created_at
    ) values (
      p_world_id,
      'matchday_completed',
      'Matchday ' || previous_matchday::text || ' completed',
      'Results and updated standings are available in Competition.',
      'matchday_completed:' || previous_matchday::text,
      jsonb_build_object('matchday', previous_matchday),
      coalesce(canonical_row.updated_at, now())
    )
    on conflict (world_id, source_key) where source_key is not null do nothing;
    get diagnostics row_count_value = row_count;
    inserted_count := inserted_count + row_count_value;
  end if;

  return inserted_count;
end;
$$;

create or replace function public.get_manager_world_feed_for_user(
  p_user_id uuid,
  p_world_id text,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  result_value jsonb;
begin
  select profile.id, appointment.club_id
    into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if manager_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  select coalesce(jsonb_agg(row_value order by item_created_at desc, item_id desc), '[]'::jsonb)
  into result_value
  from (
    select
      item.created_at as item_created_at,
      item.id as item_id,
      jsonb_build_object(
        'id', item.id,
        'item_type', item.item_type,
        'title', item.title,
        'body', item.body,
        'actor_manager_id', item.actor_manager_id,
        'actor_manager_name', actor.display_name,
        'actor_club_id', item.actor_club_id,
        'actor_club_name', coalesce(cache.read_model #>> array['club_profiles',item.actor_club_id,'club_name'], cache.read_model #>> array['club_profiles',item.actor_club_id,'canonical_name'], item.actor_club_id),
        'related_club_id', item.related_club_id,
        'related_deal_id', item.related_deal_id,
        'metadata', item.metadata,
        'created_at', item.created_at,
        'comments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', comment.id,
            'manager_id', comment.manager_id,
            'manager_name', commenter.display_name,
            'club_id', comment.club_id,
            'club_name', coalesce(cache.read_model #>> array['club_profiles',comment.club_id,'club_name'], cache.read_model #>> array['club_profiles',comment.club_id,'canonical_name'], comment.club_id),
            'body', comment.body,
            'created_at', comment.created_at,
            'edited_at', comment.edited_at
          ) order by comment.created_at asc, comment.id asc)
          from public.world_feed_comments comment
          join public.manager_profiles commenter on commenter.id = comment.manager_id
          where comment.feed_item_id = item.id and comment.hidden_at is null
        ), '[]'::jsonb)
      ) as row_value
    from public.world_feed_items item
    left join public.manager_profiles actor on actor.id = item.actor_manager_id
    join public.world_read_model_cache cache on cache.world_id = item.world_id
    join public.canonical_world_saves canonical on canonical.world_id = item.world_id and canonical.save_checksum = cache.source_checksum
    where item.world_id = p_world_id and item.hidden_at is null
    order by item.created_at desc, item.id desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) rows;

  return jsonb_build_object('world_id', p_world_id, 'club_id', club_id_value, 'manager_id', manager_id_value, 'items', result_value);
end;
$$;

create or replace function public.create_manager_world_feed_post_for_user(
  p_user_id uuid,
  p_world_id text,
  p_body text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_row public.manager_profiles;
  club_id_value text;
  item_row public.world_feed_items;
  normalized_body text;
begin
  normalized_body := trim(coalesce(p_body, ''));
  if normalized_body = '' or char_length(normalized_body) > 4000 then raise exception 'Post must be between 1 and 4000 characters'; end if;

  select profile.*, appointment.club_id into manager_row, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment on appointment.manager_id = profile.id and appointment.world_id = p_world_id and appointment.status = 'active'
  where profile.user_id = p_user_id limit 1;
  if manager_row.id is null then raise exception 'No active manager appointment for this user and world'; end if;

  insert into public.world_feed_items(world_id, item_type, actor_manager_id, actor_club_id, title, body)
  values(p_world_id, 'manager_post', manager_row.id, club_id_value, manager_row.display_name || ' · Manager post', normalized_body)
  returning * into item_row;

  return jsonb_build_object('id', item_row.id, 'created_at', item_row.created_at);
end;
$$;

create or replace function public.create_manager_world_feed_comment_for_user(
  p_user_id uuid,
  p_world_id text,
  p_feed_item_id uuid,
  p_body text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  comment_row public.world_feed_comments;
  normalized_body text;
begin
  normalized_body := trim(coalesce(p_body, ''));
  if normalized_body = '' or char_length(normalized_body) > 2000 then raise exception 'Comment must be between 1 and 2000 characters'; end if;

  select profile.id, appointment.club_id into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment on appointment.manager_id = profile.id and appointment.world_id = p_world_id and appointment.status = 'active'
  where profile.user_id = p_user_id limit 1;
  if manager_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;
  if not exists(select 1 from public.world_feed_items where id = p_feed_item_id and world_id = p_world_id and hidden_at is null) then
    raise exception 'Feed item is unavailable';
  end if;

  insert into public.world_feed_comments(feed_item_id, manager_id, club_id, body)
  values(p_feed_item_id, manager_id_value, club_id_value, normalized_body)
  returning * into comment_row;

  return jsonb_build_object('id', comment_row.id, 'created_at', comment_row.created_at);
end;
$$;

create or replace function public.hide_world_feed_item_for_user(
  p_user_id uuid,
  p_world_id text,
  p_feed_item_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_row public.manager_profiles;
begin
  select * into manager_row from public.manager_profiles where user_id = p_user_id limit 1;
  if manager_row.id is null or not coalesce(manager_row.is_admin, false) then raise exception 'Administrator access required'; end if;
  update public.world_feed_items set hidden_at = coalesce(hidden_at, now()), hidden_by_manager_id = manager_row.id
  where id = p_feed_item_id and world_id = p_world_id;
  if not found then raise exception 'Feed item not found'; end if;
  return jsonb_build_object('hidden', true, 'id', p_feed_item_id);
end;
$$;

revoke all on function public.sync_world_feed_system_items(text) from public, anon, authenticated;
revoke all on function public.get_manager_world_feed_for_user(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.create_manager_world_feed_post_for_user(uuid,text,text) from public, anon, authenticated;
revoke all on function public.create_manager_world_feed_comment_for_user(uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.hide_world_feed_item_for_user(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.sync_world_feed_system_items(text) to service_role;
grant execute on function public.get_manager_world_feed_for_user(uuid,text,integer) to service_role;
grant execute on function public.create_manager_world_feed_post_for_user(uuid,text,text) to service_role;
grant execute on function public.create_manager_world_feed_comment_for_user(uuid,text,uuid,text) to service_role;
grant execute on function public.hide_world_feed_item_for_user(uuid,text,uuid) to service_role;

commit;
