-- Opt-in public contact details for manager profiles.
-- Login/account email remains private unless a manager explicitly adds and publishes a contact email here.

begin;

create table if not exists public.manager_public_contacts (
  manager_id uuid primary key references public.manager_profiles(id) on delete cascade,
  whatsapp text,
  contact_email text,
  discord text,
  publish_whatsapp boolean not null default false,
  publish_email boolean not null default false,
  publish_discord boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint manager_public_contacts_whatsapp_length check (char_length(coalesce(whatsapp, '')) <= 240),
  constraint manager_public_contacts_email_length check (char_length(coalesce(contact_email, '')) <= 240),
  constraint manager_public_contacts_discord_length check (char_length(coalesce(discord, '')) <= 240)
);

alter table public.manager_public_contacts enable row level security;
revoke all on table public.manager_public_contacts from public, anon, authenticated;
grant select, insert, update, delete on table public.manager_public_contacts to service_role;

commit;
