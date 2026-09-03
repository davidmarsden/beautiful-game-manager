begin;

-- #389 Codex follow-up: always return reports already linked to a draft, even if
-- they later fall outside the normal candidate window or change triage status.
create or replace function public.get_alpha_updates_admin_context_for_user(
  p_user_id uuid,
  p_world_id text default 'tbg-world-1'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.manager_profiles%rowtype;
  v_updates jsonb;
  v_candidates jsonb;
begin
  select * into v_admin
  from public.manager_profiles
  where user_id = p_user_id
  limit 1;

  if v_admin.id is null or not v_admin.is_admin then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_updates
  from (
    select
      u.id,u.title,u.summary,u.status,u.published_at,u.created_at,u.updated_at,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',i.id,
          'report_id',i.report_id,
          'item_type',i.item_type,
          'public_summary',i.public_summary,
          'attribution_manager_id',i.attribution_manager_id,
          'attribution_name',m.display_name,
          'sort_order',i.sort_order
        ) order by i.sort_order,i.created_at)
        from public.alpha_update_items i
        left join public.manager_profiles m on m.id=i.attribution_manager_id
        where i.update_id=u.id
      ),'[]'::jsonb) items
    from public.alpha_updates u
    where u.world_id=p_world_id
  ) x;

  with normal_candidates as (
    select r.id
    from public.alpha_feedback_reports r
    where r.world_id = p_world_id
      and r.status in ('triaged','fixed')
      and coalesce(r.admin_note,'') not ilike 'Duplicate of canonical report%'
    order by r.updated_at desc
    limit 100
  ), draft_linked as (
    select distinct i.report_id as id
    from public.alpha_update_items i
    join public.alpha_updates u on u.id = i.update_id
    where u.world_id = p_world_id
      and u.status = 'draft'
      and i.report_id is not null
  ), candidate_ids as (
    select id from normal_candidates
    union
    select id from draft_linked
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]'::jsonb)
  into v_candidates
  from (
    select
      r.id,r.kind,r.category,r.page_area,r.status,r.severity,r.note,r.actual_result,
      r.admin_note,r.updated_at,r.manager_id,m.display_name as manager_name
    from candidate_ids c
    join public.alpha_feedback_reports r on r.id = c.id
    join public.manager_profiles m on m.id = r.manager_id
    where r.world_id = p_world_id
  ) x;

  return jsonb_build_object('ok',true,'updates',v_updates,'candidates',v_candidates);
end;
$$;

revoke all on function public.get_alpha_updates_admin_context_for_user(uuid,text)
  from public, anon, authenticated;
grant execute on function public.get_alpha_updates_admin_context_for_user(uuid,text)
  to service_role;

commit;
