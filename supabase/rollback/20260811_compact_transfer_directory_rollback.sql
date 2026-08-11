-- Roll back the compact transfer-directory projection introduced by
-- 20260811_compact_transfer_directory.sql. The previous Netlify code path can
-- still read the canonical save directly if application rollback is required.

begin;

drop function if exists public.get_manager_transfer_directory_for_user(uuid, text);

commit;
