begin;

alter table public.manager_profiles
  add column if not exists profile_completed boolean not null default false;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  supplied_name text;
begin
  supplied_name := nullif(trim(coalesce(
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name'
  )), '');

  insert into public.manager_profiles (
    user_id,
    display_name,
    email,
    profile_completed
  )
  values (
    new.id,
    coalesce(supplied_name, split_part(coalesce(new.email, 'Manager'), '@', 1)),
    new.email,
    supplied_name is not null
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

comment on column public.manager_profiles.profile_completed is
  'False until the manager has confirmed their real display name during onboarding.';

commit;
