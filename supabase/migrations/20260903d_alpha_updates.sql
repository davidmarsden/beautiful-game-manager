begin;

create table if not exists public.alpha_updates (
  id uuid primary key default gen_random_uuid(),
  world_id text not null references public.worlds(id) on delete cascade,
  title text not null,
  summary text not null default '',
  status text not null default 'draft' check (status in ('draft','published')),
  created_by_manager_id uuid references public.manager_profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alpha_updates_title_length check (char_length(title) between 1 and 160),
  constraint alpha_updates_summary_length check (char_length(summary) <= 2000)
);

create index if not exists alpha_updates_world_published_idx
  on public.alpha_updates(world_id, published_at desc nulls last, created_at desc);

create table if not exists public.alpha_update_items (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.alpha_updates(id) on delete cascade,
  report_id uuid references public.alpha_feedback_reports(id) on delete set null,
  item_type text not null check (item_type in ('fixed','improved','new','under_review')),
  public_summary text not null,
  attribution_manager_id uuid references public.manager_profiles(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint alpha_update_items_summary_length check (char_length(public_summary) between 1 and 1000)
);

create index if not exists alpha_update_items_update_idx
  on public.alpha_update_items(update_id, sort_order, created_at);
create unique index if not exists alpha_update_items_report_once_per_update
  on public.alpha_update_items(update_id, report_id)
  where report_id is not null;

create table if not exists public.alpha_update_reads (
  update_id uuid not null references public.alpha_updates(id) on delete cascade,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(update_id, manager_id)
);

alter table public.alpha_updates enable row level security;
alter table public.alpha_update_items enable row level security;
alter table public.alpha_update_reads enable row level security;
revoke all on public.alpha_updates from public, anon, authenticated;
revoke all on public.alpha_update_items from public, anon, authenticated;
revoke all on public.alpha_update_reads from public, anon, authenticated;
grant select, insert, update, delete on public.alpha_updates to service_role;
grant select, insert, update, delete on public.alpha_update_items to service_role;
grant select, insert, update, delete on public.alpha_update_reads to service_role;

alter table public.world_feed_items
  drop constraint if exists world_feed_items_item_type_check;
alter table public.world_feed_items
  add constraint world_feed_items_item_type_check
  check (item_type = any (array[
    'manager_post'::text,
    'manager_appointment'::text,
    'transfer_completed'::text,
    'matchday_upcoming'::text,
    'matchday_completed'::text,
    'matchday_press_conference'::text,
    'alpha_update'::text
  ]));

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
  if v_manager.id is null then return jsonb_build_object('ok', false, 'code', 'manager_profile_missing'); end if;

  if not exists (
    select 1 from public.manager_appointments a
    where a.world_id = p_world_id and a.manager_id = v_manager.id and a.status = 'active'
  ) then return jsonb_build_object('ok', false, 'code', 'active_appointment_required'); end if;

  select count(*)::integer into v_unread
  from public.alpha_updates u
  where u.world_id = p_world_id and u.status = 'published'
    and not exists (
      select 1 from public.alpha_update_reads r
      where r.update_id = u.id and r.manager_id = v_manager.id
    );

  select coalesce(jsonb_agg(to_jsonb(x) order by x.published_at desc), '[]'::jsonb)
  into v_updates
  from (
    select u.id, u.title, u.summary, u.published_at,
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
    where u.world_id = p_world_id and u.status = 'published'
    order by u.published_at desc
    limit 30
  ) x;

  return jsonb_build_object('ok', true, 'unread_count', v_unread, 'updates', v_updates);
end;
$$;

create or replace function public.mark_alpha_update_read_for_user(
  p_user_id uuid,
  p_update_id uuid,
  p_world_id text default 'tbg-world-1'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_manager_id uuid;
begin
  select id into v_manager_id from public.manager_profiles
  where user_id = p_user_id and status = 'active' limit 1;
  if v_manager_id is null then return jsonb_build_object('ok', false, 'code', 'manager_profile_missing'); end if;
  if not exists (select 1 from public.alpha_updates where id=p_update_id and world_id=p_world_id and status='published') then
    return jsonb_build_object('ok', false, 'code', 'update_not_found');
  end if;
  insert into public.alpha_update_reads(update_id, manager_id)
  values (p_update_id, v_manager_id)
  on conflict(update_id, manager_id) do update set read_at=now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_alpha_updates_admin_context_for_user(
  p_user_id uuid,
  p_world_id text default 'tbg-world-1'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_admin public.manager_profiles%rowtype; v_updates jsonb; v_candidates jsonb;
begin
  select * into v_admin from public.manager_profiles where user_id=p_user_id limit 1;
  if v_admin.id is null or not v_admin.is_admin then return jsonb_build_object('ok', false, 'code', 'admin_required'); end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_updates
  from (
    select u.id,u.title,u.summary,u.status,u.published_at,u.created_at,u.updated_at,
      coalesce((select jsonb_agg(jsonb_build_object(
        'id',i.id,'report_id',i.report_id,'item_type',i.item_type,'public_summary',i.public_summary,
        'attribution_manager_id',i.attribution_manager_id,'attribution_name',m.display_name,'sort_order',i.sort_order
      ) order by i.sort_order,i.created_at)
      from public.alpha_update_items i left join public.manager_profiles m on m.id=i.attribution_manager_id
      where i.update_id=u.id),'[]'::jsonb) items
    from public.alpha_updates u where u.world_id=p_world_id
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]'::jsonb) into v_candidates
  from (
    select r.id,r.kind,r.category,r.page_area,r.status,r.severity,r.note,r.actual_result,r.admin_note,r.updated_at,
           r.manager_id,m.display_name as manager_name
    from public.alpha_feedback_reports r join public.manager_profiles m on m.id=r.manager_id
    where r.world_id=p_world_id and r.status in ('triaged','fixed')
      and coalesce(r.admin_note,'') not ilike 'Duplicate of canonical report%'
    order by r.updated_at desc limit 100
  ) x;

  return jsonb_build_object('ok',true,'updates',v_updates,'candidates',v_candidates);
end;
$$;

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
  v_was_published boolean := false;
begin
  select * into v_admin from public.manager_profiles where user_id=p_admin_user_id limit 1;
  if v_admin.id is null or not v_admin.is_admin then return jsonb_build_object('ok',false,'code','admin_required'); end if;
  if trim(coalesce(p_title,''))='' then return jsonb_build_object('ok',false,'code','title_required'); end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then return jsonb_build_object('ok',false,'code','items_must_be_array'); end if;

  if p_update_id is null then
    insert into public.alpha_updates(world_id,title,summary,status,created_by_manager_id,published_at)
    values(p_world_id,trim(p_title),coalesce(trim(p_summary),''),case when p_publish then 'published' else 'draft' end,v_admin.id,case when p_publish then v_now else null end)
    returning id into v_update_id;
  else
    select (status='published') into v_was_published from public.alpha_updates where id=p_update_id and world_id=p_world_id;
    if not found then return jsonb_build_object('ok',false,'code','update_not_found'); end if;
    if v_was_published then return jsonb_build_object('ok',false,'code','published_updates_are_immutable'); end if;
    update public.alpha_updates set title=trim(p_title),summary=coalesce(trim(p_summary),''),status=case when p_publish then 'published' else 'draft' end,
      published_at=case when p_publish then v_now else null end,updated_at=v_now
    where id=p_update_id returning id into v_update_id;
    delete from public.alpha_update_items where update_id=v_update_id;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    if coalesce(v_item->>'item_type','') not in ('fixed','improved','new','under_review') then
      raise exception 'Invalid alpha update item type';
    end if;
    if trim(coalesce(v_item->>'public_summary',''))='' then raise exception 'Alpha update item summary is required'; end if;
    insert into public.alpha_update_items(update_id,report_id,item_type,public_summary,attribution_manager_id,sort_order)
    values(v_update_id,nullif(v_item->>'report_id','')::uuid,v_item->>'item_type',trim(v_item->>'public_summary'),nullif(v_item->>'attribution_manager_id','')::uuid,coalesce((v_item->>'sort_order')::integer,0));
  end loop;

  select status into v_status from public.alpha_updates where id=v_update_id;
  if p_publish and not v_was_published then
    insert into public.world_feed_items(world_id,item_type,title,body,source_key,metadata,created_at)
    values(p_world_id,'alpha_update','Alpha update: '||trim(p_title),coalesce(trim(p_summary),''),'alpha_update:'||v_update_id::text,jsonb_build_object('alpha_update_id',v_update_id),v_now)
    on conflict(world_id,source_key) where source_key is not null do nothing;

    insert into public.manager_messages(recipient_manager_id,club_id,message_type,subject,body,priority,metadata,created_at)
    select a.manager_id,a.club_id,'alpha_update','Alpha update: '||trim(p_title),
      case when trim(coalesce(p_summary,''))='' then 'A new alpha update has been published. Open What''s New to see the changes.' else trim(p_summary) end,
      'normal',jsonb_build_object('alpha_update_id',v_update_id,'action_url','/alpha-updates.html'),v_now
    from public.manager_appointments a join public.manager_profiles m on m.id=a.manager_id
    where a.world_id=p_world_id and a.status='active' and m.status='active';

    insert into public.manager_notifications(world_id,manager_id,notification_type,notification_class,title,body,action_url,source_type,source_id,dedupe_key,created_at)
    select p_world_id,a.manager_id,'alpha_update','info','What''s New: '||trim(p_title),
      'A new Alpha Update is available.','/alpha-updates.html','alpha_update',v_update_id::text,'alpha_update:'||v_update_id::text,v_now
    from public.manager_appointments a join public.manager_profiles m on m.id=a.manager_id
    where a.world_id=p_world_id and a.status='active' and m.status='active'
    on conflict(manager_id,dedupe_key) do nothing;
  end if;

  return jsonb_build_object('ok',true,'update_id',v_update_id,'status',v_status);
end;
$$;

revoke all on function public.get_alpha_updates_for_user(uuid,text) from public,anon,authenticated;
revoke all on function public.mark_alpha_update_read_for_user(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.get_alpha_updates_admin_context_for_user(uuid,text) from public,anon,authenticated;
revoke all on function public.admin_save_alpha_update(uuid,text,uuid,text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.get_alpha_updates_for_user(uuid,text) to service_role;
grant execute on function public.mark_alpha_update_read_for_user(uuid,uuid,text) to service_role;
grant execute on function public.get_alpha_updates_admin_context_for_user(uuid,text) to service_role;
grant execute on function public.admin_save_alpha_update(uuid,text,uuid,text,text,jsonb,boolean) to service_role;

commit;
