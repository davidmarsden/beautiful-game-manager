begin;

insert into public.manager_world_activity (manager_id, world_id, last_active_at)
select
  mp.id,
  ma.world_id,
  au.last_sign_in_at
from public.manager_profiles mp
join auth.users au on au.id = mp.user_id
join public.manager_appointments ma
  on ma.manager_id = mp.id
 and ma.status = 'active'
where au.last_sign_in_at is not null
on conflict (manager_id, world_id) do nothing;

commit;
