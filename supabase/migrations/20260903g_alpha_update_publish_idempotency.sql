begin;

-- Fresh composers now allocate their Alpha Update UUID client-side before the
-- first write. Treat that UUID as the idempotency key: create it if absent,
-- update it while still a draft, and make a retry of an already-published ID a
-- no-op success so a lost HTTP response cannot broadcast the same update twice.
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
  v_existing_world_id text;
begin
  select * into v_admin
  from public.manager_profiles
  where user_id = p_admin_user_id
  limit 1;

  if v_admin.id is null or not v_admin.is_admin then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;
  if p_update_id is null then
    return jsonb_build_object('ok', false, 'code', 'update_id_required');
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

  select world_id, status
  into v_existing_world_id, v_current_status
  from public.alpha_updates
  where id = p_update_id
  for update;

  if found then
    if v_existing_world_id <> p_world_id then
      return jsonb_build_object('ok', false, 'code', 'update_id_conflict');
    end if;

    if v_current_status = 'published' then
      if p_publish then
        -- Idempotent retry after the original publication committed but its HTTP
        -- response was lost. Do not rewrite content or emit another broadcast.
        return jsonb_build_object(
          'ok', true,
          'update_id', p_update_id,
          'status', 'published',
          'idempotent_replay', true
        );
      end if;
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
  else
    insert into public.alpha_updates(
      id, world_id, title, summary, status, created_by_manager_id, published_at
    ) values (
      p_update_id,
      p_world_id,
      trim(p_title),
      coalesce(trim(p_summary), ''),
      case when p_publish then 'published' else 'draft' end,
      v_admin.id,
      case when p_publish then v_now else null end
    )
    returning id into v_update_id;
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

revoke all on function public.admin_save_alpha_update(uuid,text,uuid,text,text,jsonb,boolean)
  from public, anon, authenticated;
grant execute on function public.admin_save_alpha_update(uuid,text,uuid,text,text,jsonb,boolean)
  to service_role;

commit;
