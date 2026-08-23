-- #287: immutable transfer terms must use the same penny precision as canonical finance settlement.
--
-- This is deliberately enforced at the transfer_deal_legs persistence boundary so proposals,
-- counters and any future service writer fail inside the revision transaction rather than
-- producing an agreed deal that can only fail later during settlement.

begin;

alter table public.transfer_deal_legs
  drop constraint if exists transfer_deal_legs_cash_penny_precision;

alter table public.transfer_deal_legs
  add constraint transfer_deal_legs_cash_penny_precision
  check (
    leg_type <> 'cash'
    or amount is null
    or amount = round(amount, 2)
  ) not valid;

commit;
