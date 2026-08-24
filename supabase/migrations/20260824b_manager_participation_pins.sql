-- Meaningful participation, not presence monitoring.
-- Derived from authoritative football/community actions already stored by TBG.

begin;

create or replace function public.get_manager_participation_for_user(
  p_user_id uuid,
  p_world_id text,
  p_target_manager_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid;
  target_id uuid;
  target_name text;
  target_club_id text;
  target_club_name text;
  appointed_at timestamptz;
  current_season text;
  current_matchday integer;
  is_self boolean;
  submissions integer := 0;
  on_time_submissions integer := 0;
  current_season_due integer := 0;
  current_season_on_time integer := 0;
  posts integer := 0;
  comments integer := 0;
  replies_received integer := 0;
  transfer_deals integer := 0;
  commands integer := 0;
  last_meaningful_at timestamptz;
  recent jsonb := '[]'::jsonb;
  pins jsonb := '[]'::jsonb;
begin
  select profile.id into caller_id
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if caller_id is null then raise exception 'No active manager appointment for this user and world'; end if;

  target_id := coalesce(p_target_manager_id, caller_id);
  select profile.display_name, appointment.club_id, appointment.appointed_at,
         coalesce(cache.read_model #>> array['club_profiles',appointment.club_id,'club_name'],
                  cache.read_model #>> array['club_profiles',appointment.club_id,'canonical_name'],
                  appointment.club_id)
    into target_name, target_club_id, appointed_at, target_club_name
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  left join public.world_read_model_cache cache on cache.world_id = appointment.world_id
  where profile.id = target_id
  limit 1;
  if target_name is null then raise exception 'Manager is not active in this world'; end if;

  is_self := target_id = caller_id;
  select season_id, matchday into current_season, current_matchday
  from public.canonical_world_saves where world_id = p_world_id limit 1;

  select count(*)::integer,
         count(*) filter (where run.scheduled_for is null or submission.submitted_at <= run.scheduled_for)::integer
    into submissions, on_time_submissions
  from public.manager_turn_submissions submission
  left join public.world_turn_runs run
    on run.world_id = submission.world_id
   and run.season_id = submission.season_id
   and run.matchday = submission.matchday
  where submission.world_id = p_world_id and submission.manager_id = target_id
    and submission.status in ('submitted','locked','consumed');

  current_season_due := greatest(coalesce(current_matchday, 1) - 1, 0);
  select count(*) filter (where run.scheduled_for is null or submission.submitted_at <= run.scheduled_for)::integer
    into current_season_on_time
  from public.manager_turn_submissions submission
  left join public.world_turn_runs run
    on run.world_id = submission.world_id
   and run.season_id = submission.season_id
   and run.matchday = submission.matchday
  where submission.world_id = p_world_id and submission.manager_id = target_id
    and submission.season_id = current_season
    and submission.matchday < coalesce(current_matchday, 1)
    and submission.status in ('submitted','locked','consumed');

  select count(*)::integer into commands
  from public.manager_world_commands command
  where command.world_id = p_world_id and command.manager_id = target_id;

  if to_regclass('public.world_feed_items') is not null then
    select count(*)::integer into posts
    from public.world_feed_items item
    where item.world_id = p_world_id and item.actor_manager_id = target_id
      and item.item_type = 'manager_post' and item.hidden_at is null;
  end if;
  if to_regclass('public.world_feed_comments') is not null then
    select count(*)::integer into comments
    from public.world_feed_comments comment
    join public.world_feed_items item on item.id = comment.feed_item_id
    where item.world_id = p_world_id and comment.manager_id = target_id and comment.hidden_at is null;

    select count(*)::integer into replies_received
    from public.world_feed_comments comment
    join public.world_feed_items item on item.id = comment.feed_item_id
    where item.world_id = p_world_id and item.actor_manager_id = target_id
      and item.item_type = 'manager_post' and item.hidden_at is null
      and comment.manager_id <> target_id and comment.hidden_at is null;
  end if;

  if to_regclass('public.transfer_deals') is not null and to_regclass('public.transfer_deal_legs') is not null then
    select count(distinct deal.id)::integer into transfer_deals
    from public.transfer_deals deal
    join public.transfer_deal_revisions revision on revision.deal_id = deal.id and revision.revision_no = deal.current_revision_no
    join public.transfer_deal_legs leg on leg.revision_id = revision.id
    where deal.world_id = p_world_id and deal.status = 'completed'
      and coalesce(deal.terminal_at, deal.updated_at) >= coalesce(appointed_at, '-infinity'::timestamptz)
      and (leg.from_club_id = target_club_id or leg.to_club_id = target_club_id);
  end if;

  select max(activity_at) into last_meaningful_at from (
    select max(submitted_at) activity_at from public.manager_turn_submissions where world_id = p_world_id and manager_id = target_id
    union all select max(submitted_at) from public.manager_world_commands where world_id = p_world_id and manager_id = target_id
    union all select max(created_at) from public.world_feed_items where world_id = p_world_id and actor_manager_id = target_id and item_type = 'manager_post' and hidden_at is null
    union all select max(comment.created_at) from public.world_feed_comments comment join public.world_feed_items item on item.id = comment.feed_item_id where item.world_id = p_world_id and comment.manager_id = target_id and comment.hidden_at is null
  ) activity;

  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', kind,
      'label', label,
      'period', case
        when occurred_at >= now() - interval '1 day' then 'Today'
        when occurred_at >= now() - interval '7 days' then 'This week'
        when occurred_at >= now() - interval '30 days' then 'Recently'
        else 'Earlier'
      end
    ) order by occurred_at desc), '[]'::jsonb)
    into recent
  from (
    select 'team'::text kind, 'Team submitted'::text label, submitted_at occurred_at
      from public.manager_turn_submissions where world_id = p_world_id and manager_id = target_id
    union all
    select 'football', case
      when command_type = 'transfer_offer' then 'Transfer offer made'
      when command_type = 'transfer_response' then 'Transfer negotiation answered'
      when command_type = 'transfer_listing' then 'Transfer market updated'
      when command_type in ('register_player','unregister_player') then 'Squad registration changed'
      when command_type = 'renew_contract' then 'Contract renewed'
      else 'Club action completed' end, submitted_at
      from public.manager_world_commands where world_id = p_world_id and manager_id = target_id
    union all
    select 'social', 'Posted to the World Feed', created_at
      from public.world_feed_items where world_id = p_world_id and actor_manager_id = target_id and item_type = 'manager_post' and hidden_at is null
    union all
    select 'social', 'Joined a World Feed conversation', comment.created_at
      from public.world_feed_comments comment join public.world_feed_items item on item.id = comment.feed_item_id
      where item.world_id = p_world_id and comment.manager_id = target_id and comment.hidden_at is null
    order by occurred_at desc limit 8
  ) activity_rows;

  pins := jsonb_build_array();
  if submissions >= 1 then pins := pins || jsonb_build_array(jsonb_build_object('key','ready_to_play','icon','📋','name','Ready to Play','description','Submitted a team for a TBG matchday.')); end if;
  if on_time_submissions >= 5 then pins := pins || jsonb_build_array(jsonb_build_object('key','reliable','icon','⏰','name','Reliable','description','Submitted at least five teams on time.')); end if;
  if current_season_due >= 3 and current_season_on_time = current_season_due then pins := pins || jsonb_build_array(jsonb_build_object('key','ever_present','icon','🗓️','name','Ever Present','description','On-time team sheet for every completed matchday this season.')); end if;
  if posts >= 1 then pins := pins || jsonb_build_array(jsonb_build_object('key','from_dugout','icon','✍️','name','From the Dugout','description','Posted to the World Feed.')); end if;
  if comments >= 5 then pins := pins || jsonb_build_array(jsonb_build_object('key','in_conversation','icon','💬','name','In the Conversation','description','Joined at least five World Feed conversations.')); end if;
  if replies_received >= 1 then pins := pins || jsonb_build_array(jsonb_build_object('key','conversation_starter','icon','🗣️','name','Conversation Starter','description','Started a World Feed post that another manager replied to.')); end if;
  if transfer_deals >= 1 then pins := pins || jsonb_build_array(jsonb_build_object('key','transfer_business','icon','🔄','name','Transfer Business','description','Completed a transfer while in charge of this club.')); end if;
  if transfer_deals >= 5 then pins := pins || jsonb_build_array(jsonb_build_object('key','deal_maker','icon','🤝','name','Deal Maker','description','Completed five transfer deals while in charge of this club.')); end if;

  return jsonb_build_object(
    'manager_id', target_id,
    'manager_name', target_name,
    'club_id', target_club_id,
    'club_name', target_club_name,
    'is_self', is_self,
    'principle', 'Meaningful participation, not presence monitoring.',
    'recent_activity', recent,
    'pins', pins,
    'last_meaningful_period', case
      when last_meaningful_at is null then 'No recent manager activity'
      when last_meaningful_at >= now() - interval '1 day' then 'Active today'
      when last_meaningful_at >= now() - interval '7 days' then 'Active this week'
      when last_meaningful_at >= now() - interval '30 days' then 'Active recently'
      else 'No recent manager activity'
    end,
    'private_detail', case when is_self then jsonb_build_object(
      'team_submissions', submissions,
      'on_time_team_submissions', on_time_submissions,
      'football_actions', commands,
      'world_feed_posts', posts,
      'world_feed_comments', comments,
      'replies_received', replies_received,
      'completed_transfers', transfer_deals
    ) else null end
  );
end;
$$;

revoke all on function public.get_manager_participation_for_user(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.get_manager_participation_for_user(uuid,text,uuid) to service_role;

commit;
