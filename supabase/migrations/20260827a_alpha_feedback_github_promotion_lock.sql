begin;

alter table public.alpha_feedback_reports
  add column if not exists github_promotion_token uuid,
  add column if not exists github_promotion_started_at timestamptz;

create or replace function public.admin_reserve_alpha_feedback_promotion(
  p_admin_user_id uuid,
  p_report_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.manager_profiles%rowtype;
  v_report public.alpha_feedback_reports%rowtype;
  v_token uuid := gen_random_uuid();
begin
  select * into v_admin from public.manager_profiles where user_id = p_admin_user_id limit 1;
  if v_admin.id is null or not v_admin.is_admin then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;

  select * into v_report
  from public.alpha_feedback_reports
  where id = p_report_id
  for update;

  if v_report.id is null then
    return jsonb_build_object('ok', false, 'code', 'report_not_found');
  end if;

  if v_report.github_issue_url is not null then
    return jsonb_build_object('ok', true, 'already_linked', true, 'issue_url', v_report.github_issue_url);
  end if;

  if v_report.github_promotion_token is not null
     and v_report.github_promotion_started_at > now() - interval '5 minutes' then
    return jsonb_build_object('ok', false, 'code', 'promotion_in_progress');
  end if;

  update public.alpha_feedback_reports
  set github_promotion_token = v_token,
      github_promotion_started_at = now(),
      updated_at = now()
  where id = p_report_id;

  return jsonb_build_object('ok', true, 'promotion_token', v_token);
end;
$$;

create or replace function public.admin_finish_alpha_feedback_promotion(
  p_admin_user_id uuid,
  p_report_id uuid,
  p_promotion_token uuid,
  p_status text,
  p_severity text default null,
  p_admin_note text default null,
  p_github_issue_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.manager_profiles%rowtype;
begin
  select * into v_admin from public.manager_profiles where user_id = p_admin_user_id limit 1;
  if v_admin.id is null or not v_admin.is_admin then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;
  if p_status not in ('new','triaged','fixed','wont_fix') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;
  if p_severity is not null and p_severity not in ('low','medium','high','critical') then
    return jsonb_build_object('ok', false, 'code', 'invalid_severity');
  end if;

  update public.alpha_feedback_reports
  set status = p_status,
      severity = p_severity,
      admin_note = nullif(trim(p_admin_note),''),
      github_issue_url = nullif(trim(p_github_issue_url),''),
      github_promotion_token = null,
      github_promotion_started_at = null,
      updated_at = now()
  where id = p_report_id
    and github_promotion_token = p_promotion_token;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'promotion_reservation_lost');
  end if;

  return jsonb_build_object('ok', true, 'report_id', p_report_id);
end;
$$;

create or replace function public.admin_release_alpha_feedback_promotion(
  p_admin_user_id uuid,
  p_report_id uuid,
  p_promotion_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.manager_profiles%rowtype;
begin
  select * into v_admin from public.manager_profiles where user_id = p_admin_user_id limit 1;
  if v_admin.id is null or not v_admin.is_admin then
    return jsonb_build_object('ok', false, 'code', 'admin_required');
  end if;

  update public.alpha_feedback_reports
  set github_promotion_token = null,
      github_promotion_started_at = null,
      updated_at = now()
  where id = p_report_id
    and github_promotion_token = p_promotion_token;

  return jsonb_build_object('ok', true, 'report_id', p_report_id);
end;
$$;

revoke all on function public.admin_reserve_alpha_feedback_promotion(uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_finish_alpha_feedback_promotion(uuid,uuid,uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.admin_release_alpha_feedback_promotion(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.admin_reserve_alpha_feedback_promotion(uuid,uuid) to service_role;
grant execute on function public.admin_finish_alpha_feedback_promotion(uuid,uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.admin_release_alpha_feedback_promotion(uuid,uuid,uuid) to service_role;

commit;
