begin;

-- Alpha Updates may be published through the admin RPC or by an operational
-- database repair. Delivery belongs to the publication state transition, not
-- to one particular caller. The deferred trigger below therefore makes the
-- database publication row the authoritative broadcast boundary while the
-- existing admin RPC remains fully compatible.

create or replace function public.alpha_update_message_subject(p_title text)
returns text
language sql
immutable
as $$
  select left(
    case
      when lower(trim(coalesce(p_title, ''))) like 'alpha update%'
        then trim(coalesce(p_title, ''))
      else 'Alpha update: ' || trim(coalesce(p_title, ''))
    end,
    160
  );
$$;

-- One manager must never receive the same Alpha Update twice, including after
-- an RPC retry, a direct operational repair, or a deferred-trigger replay.
create unique index if not exists manager_messages_alpha_update_recipient_uidx
  on public.manager_messages(recipient_manager_id, ((metadata->>'alpha_update_id')))
  where message_type = 'alpha_update'
    and metadata ? 'alpha_update_id';

-- Normalise subjects produced by older callers too. Looking up the canonical
-- update title means a caller cannot accidentally create "Alpha update: Alpha
-- Update — ..." simply by prepending the generic label to an already-labelled
-- title.
create or replace function public.normalise_alpha_update_broadcast_subject()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_update_id uuid;
  v_title text;
begin
  if tg_table_name = 'manager_messages' and new.message_type <> 'alpha_update' then
    return new;
  end if;
  if tg_table_name = 'world_feed_items' and new.item_type <> 'alpha_update' then
    return new;
  end if;

  begin
    v_update_id := nullif(new.metadata->>'alpha_update_id', '')::uuid;
  exception when invalid_text_representation then
    v_update_id := null;
  end;

  if v_update_id is not null then
    select title into v_title from public.alpha_updates where id = v_update_id;
  end if;

  if tg_table_name = 'manager_messages' then
    new.subject := public.alpha_update_message_subject(coalesce(v_title, new.subject));
  else
    new.title := public.alpha_update_message_subject(coalesce(v_title, new.title));
  end if;
  return new;
end;
$$;

drop trigger if exists manager_messages_normalise_alpha_update_subject on public.manager_messages;
create trigger manager_messages_normalise_alpha_update_subject
before insert or update of subject, metadata, message_type on public.manager_messages
for each row execute function public.normalise_alpha_update_broadcast_subject();

drop trigger if exists world_feed_normalise_alpha_update_subject on public.world_feed_items;
create trigger world_feed_normalise_alpha_update_subject
before insert or update of title, metadata, item_type on public.world_feed_items
for each row execute function public.normalise_alpha_update_broadcast_subject();

create or replace function public.deliver_published_alpha_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(new.published_at, now());
begin
  -- Constraint triggers covering INSERT and UPDATE also see unrelated edits.
  -- Broadcast exactly once when a row first becomes published.
  if new.status <> 'published' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' then
    return null;
  end if;

  insert into public.world_feed_items(
    world_id, item_type, title, body, source_key, metadata, created_at
  ) values (
    new.world_id,
    'alpha_update',
    public.alpha_update_message_subject(new.title),
    coalesce(trim(new.summary), ''),
    'alpha_update:' || new.id::text,
    jsonb_build_object('alpha_update_id', new.id),
    v_now
  )
  on conflict(world_id, source_key) where source_key is not null do nothing;

  insert into public.manager_messages(
    recipient_manager_id, club_id, message_type, subject, body,
    priority, metadata, created_at
  )
  select
    a.manager_id,
    a.club_id,
    'alpha_update',
    public.alpha_update_message_subject(new.title),
    case
      when trim(coalesce(new.summary, '')) = ''
        then 'A new alpha update has been published. Open What''s New to see the changes.'
      else trim(new.summary)
    end,
    'normal',
    jsonb_build_object('alpha_update_id', new.id, 'action_url', '/alpha-updates.html'),
    v_now
  from public.manager_appointments a
  join public.manager_profiles m on m.id = a.manager_id
  where a.world_id = new.world_id
    and a.status = 'active'
    and m.status = 'active'
  on conflict (recipient_manager_id, ((metadata->>'alpha_update_id')))
    where message_type = 'alpha_update' and metadata ? 'alpha_update_id'
    do nothing;

  insert into public.manager_notifications(
    world_id, manager_id, notification_type, notification_class,
    title, body, action_url, source_type, source_id, dedupe_key, created_at
  )
  select
    new.world_id,
    a.manager_id,
    'alpha_update',
    'info',
    left('What''s New: ' || trim(new.title), 160),
    'A new Alpha Update is available.',
    '/alpha-updates.html',
    'alpha_update',
    new.id::text,
    'alpha_update:' || new.id::text,
    v_now
  from public.manager_appointments a
  join public.manager_profiles m on m.id = a.manager_id
  where a.world_id = new.world_id
    and a.status = 'active'
    and m.status = 'active'
  on conflict(manager_id, dedupe_key) do nothing;

  return null;
end;
$$;

-- Deferred execution is intentional. admin_save_alpha_update still performs its
-- historical broadcast inside the RPC; by commit time those rows already exist
-- and the unique/dedupe constraints make this trigger a no-op. A publication
-- performed outside that RPC, however, now receives the exact same delivery.
drop trigger if exists alpha_updates_deliver_on_publish on public.alpha_updates;
create constraint trigger alpha_updates_deliver_on_publish
after insert or update on public.alpha_updates
deferrable initially deferred
for each row
execute function public.deliver_published_alpha_update();

revoke all on function public.alpha_update_message_subject(text) from public, anon, authenticated;
revoke all on function public.normalise_alpha_update_broadcast_subject() from public, anon, authenticated;
revoke all on function public.deliver_published_alpha_update() from public, anon, authenticated;

grant execute on function public.alpha_update_message_subject(text) to service_role;

commit;
