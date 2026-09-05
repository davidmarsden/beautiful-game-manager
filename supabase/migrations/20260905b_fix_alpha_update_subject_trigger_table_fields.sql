-- Fix the Alpha Update subject normaliser so each trigger path only references
-- columns that exist on the table currently firing the trigger.
--
-- The original shared trigger function evaluated NEW.message_type while firing
-- on world_feed_items, where that field does not exist. This made publication
-- fail before the update could broadcast. Keep the shared function, but branch
-- on TG_TABLE_NAME before touching table-specific fields.

create or replace function public.normalise_alpha_update_broadcast_subject()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_update_id uuid;
  v_title text;
begin
  if tg_table_name = 'manager_messages' then
    if new.message_type <> 'alpha_update' then
      return new;
    end if;
  elsif tg_table_name = 'world_feed_items' then
    if new.item_type <> 'alpha_update' then
      return new;
    end if;
  else
    return new;
  end if;

  begin
    v_update_id := nullif(new.metadata->>'alpha_update_id', '')::uuid;
  exception when invalid_text_representation then
    v_update_id := null;
  end;

  if v_update_id is not null then
    select title into v_title
    from public.alpha_updates
    where id = v_update_id;
  end if;

  if tg_table_name = 'manager_messages' then
    new.subject := public.alpha_update_message_subject(coalesce(v_title, new.subject));
  else
    new.title := public.alpha_update_message_subject(coalesce(v_title, new.title));
  end if;

  return new;
end;
$$;
