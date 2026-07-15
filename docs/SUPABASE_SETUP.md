# Phase 2C.2a — Supabase setup

This setup is designed to be completed entirely through the Supabase, Netlify and GitHub web interfaces. No local terminal is required.

## 1. Run the database migration

In Supabase:

1. Open **SQL Editor**.
2. Create a new query.
3. Copy the complete contents of:
   `supabase/migrations/20260715_phase_2c2a_auth_foundation.sql`
4. Run it once.

This creates:

- `worlds`
- `clubs`
- `manager_profiles`
- `manager_appointments`
- `fixtures`
- `manager_messages`
- Row Level Security policies
- automatic manager-profile creation after a new Auth user signs up

New tables fail closed: RLS is enabled and only the explicit policies in the migration grant access.

## 2. Configure Supabase Auth URLs

In **Authentication → URL Configuration** set:

- Site URL: `https://tbg-manager-portal.netlify.app`
- Redirect URL: `https://tbg-manager-portal.netlify.app/**`

Add the Netlify deploy-preview wildcard too when available:

- `https://deploy-preview-*--tbg-manager-portal.netlify.app/**`

The portal uses passwordless email magic links.

## 3. Copy the public browser key

In **Project Settings → API**, copy the publishable/anon key.

The project URL is:

`https://[enter your code here].supabase.co`

Do not use the service-role key in the browser.

## 4. Add Netlify environment variables

In the Netlify site, add:

- `SUPABASE_URL` = `https://[enter your code here].supabase.co`
- `SUPABASE_ANON_KEY` = the Supabase publishable/anon key

Trigger a new Netlify deploy after saving them.

## 5. Sync the 80 TBG clubs

The repository includes the manual GitHub Action **Sync TBG World to Supabase**.

Add these GitHub Actions repository secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The service-role key is server-only and must never be added to Netlify's public browser configuration or committed to the repository.

Then run:

**Actions → Sync TBG World to Supabase → Run workflow**

The action imports the current world and all 80 canonical clubs from `beautiful-game-engine`.

## 6. Create the first manager account

Use the live portal login form and enter the manager's email address. The first successful sign-in creates an Auth user and a matching `manager_profiles` row automatically.

The manager will initially see **No club assigned yet**. This is deliberate: the portal no longer silently selects Real Madrid or any other club.

## 7. Assign a manager to a club

In the SQL Editor, replace the email and club ID below:

```sql
insert into public.manager_appointments (
  manager_id,
  world_id,
  club_id,
  control_type,
  status
)
select
  profile.id,
  'tbg-world-1',
  'REPLACE_WITH_TBG_CLUB_ID',
  'human',
  'active'
from public.manager_profiles profile
where lower(profile.email) = lower('manager@example.com');
```

Reloading the portal will now open that manager's assigned club and squad.

## 8. Optional first inbox message

```sql
insert into public.manager_messages (
  recipient_manager_id,
  club_id,
  message_type,
  subject,
  body,
  priority
)
select
  profile.id,
  appointment.club_id,
  'appointment',
  'Welcome to The Beautiful Game',
  'Your appointment is confirmed. Your club is ready for the inaugural season.',
  'high'
from public.manager_profiles profile
join public.manager_appointments appointment
  on appointment.manager_id = profile.id
 and appointment.status = 'active'
where lower(profile.email) = lower('manager@example.com');
```

## Security contract

- Browser code receives only the public anon key.
- Netlify validates the Supabase session before returning club data.
- RLS restricts profiles, appointments, fixtures and inbox messages.
- A manager cannot select another club by changing a URL parameter.
- Team submissions must match the authenticated manager's active appointment.
- The service-role key is used only by the manual GitHub sync action.
