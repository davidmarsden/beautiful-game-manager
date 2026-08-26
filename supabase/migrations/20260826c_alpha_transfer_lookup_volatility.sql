-- The hardened read gateways may refresh the compact transfer directory on a cache miss.
-- They therefore cannot truthfully remain STABLE.

begin;

alter function public.get_manager_transfer_lookup_for_user(uuid,text) volatile;
alter function public.get_manager_legacy_outgoing_transfer_offers_for_user(uuid,text) volatile;
alter function public.get_manager_transfer_listings_for_user(uuid,text) volatile;
alter function public.get_manager_transfer_exchange_legs_for_user(uuid,text) volatile;
alter function public.get_manager_transfer_history_for_user(uuid,text,integer) volatile;
alter function public.get_world_transfer_register_for_user(uuid,text,integer) volatile;
alter function public.get_manager_transfer_market_for_user(uuid,text) volatile;

commit;
