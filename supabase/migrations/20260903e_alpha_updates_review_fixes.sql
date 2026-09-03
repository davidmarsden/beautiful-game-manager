begin;

-- Codex review follow-up for #389.
-- Keep the complete published history available so unread state and visible history
-- cannot diverge after an arbitrary page-size boundary.
create or replace function public.get_alpha_updates_for_user(
  p_user_id uuid,
  p_world_id text default 'tbg-world-1'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_manager public.manager_profiles%rowtype;
  v_updates jsonb;
  v_unread integer;
begin
  select * into v_manager
  from public.manager_profiles
  where user_id = p_user_id and status = 'active'
  limit 1;
  if v_manager.id is null then
    return jsonb_build_object('ok', false, 'code', 'manager_profile_missing');
  end if;

  if not exists (
    select 1 from public.manager_appointments a
    where a.world_id = p_world_id
      and a.manager_id = v_manager.id
      and a.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'active_appointment_required');
  end if;

  select count(*)::integer into v_unread
  from public.alpha_updates u
  where u.world_id = p_world_id
    and u.status = 'published'
    and not exists (
      select 1 from public.alpha_update_reads r
      where r.update_id = u.id and r.manager_id = v_manager.id
    );

  select coalesce(jsonb_agg(to_jsonb(x) order by x.published_at desc), '[]'::jsonb)
  into v_updates
  from (
    select
      u.id,
      u.title,
      u.summary,
      u.published_at,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'item_type', i.item_type,
          'public_summary', i.public_summary,
          'attribution_manager_id', i.attribution_manager_id,
          'attribution_name', m.display_name
        ) order by i.sort_order, i.created_at)
        from public.alpha_update_items i
        left join public.manager_profiles m on m.id = i.attribution_manager_id
        where i.update_id = u.id
      ), '[]'::jsonb) as items,
      exists (
        select 1 from public.alpha_update_reads r
        where r.update_id = u.id and r.manager_id = v_manager.id
      ) as is_read
    from public.alpha_updates u
    where u.world_id = p_world_id
      and u.status = 'published'
    order by u.published_at desc
  ) x;

  return jsonb_build_object('ok', true, 'unread_count', v_unread, 'updates', v_updates);
end;
$$;

-- Serialize edits/publication of an existing draft. A request that loses the row
-- lock race re-reads the now-published state and is rejected, preventing a stale
-- save from reverting publication or a second publish from duplicating messages.
create or replace function public.admin_save_alpha_update(
  p_admin_user_id uuid,
  p_world_id text,
  p_update_id uuid,
  p_title text,
  p_summary text,
  p_items jsonb,
  p_publish boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.manager_profiles%rowtype;
  v_update_id uuid;
  v_now timestamptz := now();
  v_item jsonb;
  v_status text;
  v_current_status text;
begin
  select * into v_admin
  from public.manager_profiles
  where user_id = p_admin_user_id
  limit 1;

  if v_admin.id is null or not v_admin.is_admin then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;
  if trim(coalesce(p_title, '')) = '' then
    return jsonb_build_object('ok', false, 'code', 'title_required');
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'items_must_be_array');
  end if;
  if p_publish and jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'publish_requires_items');
  end if;

  if p_update_id is null then
    insert into public.alpha_updates(
      world_id, title, summary, status, created_by_manager_id, published_at
    ) values (
      p_world_id,
      trim(p_title),
      coalesce(trim(p_summary), ''),
      case when p_publish then 'published' else 'draft' end,
      v_admin.id,
      case when p_publish then v_now else null end
    ) returning id into v_update_id;
  else
    select status into v_current_status
    from public.alpha_updates
    where id = p_update_id and world_id = p_world_id
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'update_not_found');
    end if;
    if v_current_status = 'published' then
      return jsonb_build_object('ok', false, 'code', 'published_updates_are_immutable');
    end if;

    update public.alpha_updates
    set title = trim(p_title),
        summary = coalesce(trim(p_summary), ''),
        status = case when p_publish then 'published' else 'draft' end,
        published_at = case when p_publish then v_now else null end,
        updated_at = v_now
    where id = p_update_id
      and world_id = p_world_id
      and status = 'draft'
    returning id into v_update_id;

    if v_update_id is null then
      return jsonb_build_object('ok', false, 'code', 'draft_state_changed');
    end if;

    delete from public.alpha_update_items where update_id = v_update_id;
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if coalesce(v_item->>'item_type', '') not in ('fixed','improved','new','under_review') then
      raise exception 'Invalid alpha update item type';
    end if;
    if trim(coalesce(v_item->>'public_summary', '')) = '' then
      raise exception 'Alpha update item summary is required';
    end if;

    insert into public.alpha_update_items(
      update_id, report_id, item_type, public_summary,
      attribution_manager_id, sort_order
    ) values (
      v_update_id,
      nullif(v_item->>'report_id', '')::uuid,
      v_item->>'item_type',
      trim(v_item->>'public_summary'),
      nullif(v_item->>'attribution_manager_id', '')::uuid,
      coalesce((v_item->>'sort_order')::integer, 0)
    );
  end loop;

  select status into v_status
  from public.alpha_updates
  where id = v_update_id;

  if p_publish then
    insert into public.world_feed_items(
      world_id, item_type, title, body, source_key, metadata, created_at
    ) values (
      p_world_id,
      'alpha_update',
      left('Alpha update: ' || trim(p_title), 160),
      coalesce(trim(p_summary), ''),
      'alpha_update:' || v_update_id::text,
      jsonb_build_object('alpha_update_id', v_update_id),
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
      'Alpha update: ' || trim(p_title),
      case
        when trim(coalesce(p_summary, '')) = ''
          then 'A new alpha update has been published. Open What''s New to see the changes.'
        else trim(p_summary)
      end,
      'normal',
      jsonb_build_object('alpha_update_id', v_update_id, 'action_url', '/alpha-updates.html'),
      v_now
    from public.manager_appointments a
    join public.manager_profiles m on m.id = a.manager_id
    where a.world_id = p_world_id
      and a.status = 'active'
      and m.status = 'active';

    insert into public.manager_notifications(
      world_id, manager_id, notification_type, notification_class,
      title, body, action_url, source_type, source_id, dedupe_key, created_at
    )
    select
      p_world_id,
      a.manager_id,
      'alpha_update',
      'info',
      'What''s New: ' || trim(p_title),
      'A new Alpha Update is available.',
      '/alpha-updates.html',
      'alpha_update',
      v_update_id::text,
      'alpha_update:' || v_update_id::text,
      v_now
    from public.manager_appointments a
    join public.manager_profiles m on m.id = a.manager_id
    where a.world_id = p_world_id
      and a.status = 'active'
      and m.status = 'active'
    on conflict(manager_id, dedupe_key) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'update_id', v_update_id, 'status', v_status);
end;
$$;

revoke all on function public.get_alpha_updates_for_user(uuid,text)
  from public, anon, authenticated;
revoke all on function public.admin_save_alpha_update(uuid,text,uuid,text,text,jsonb,boolean)
  from public, anon, authenticated;
grant execute on function public.get_alpha_updates_for_user(uuid,text) to service_role;
grant execute on function public.admin_save_alpha_update(uuid,text,uuid,text,text,jsonb,boolean) to service_role;

commit;
