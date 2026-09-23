-- Phase 2 A2: controlled backfill of opaque payment codes for Fase 1 cards.
-- Production currently has one card; re-check counts before application.
-- Provenance fields stay NULL for legacy cards because payment method is unknown.
update public.gift_cards
set online_payment_code = encode(extensions.gen_random_bytes(16), 'hex')
where online_payment_code is null;

do $$
begin
  if exists (select 1 from public.gift_cards where online_payment_code is null) then
    raise exception 'Gift Card payment-code backfill is incomplete';
  end if;
  if exists (
    select online_payment_code from public.gift_cards
    group by online_payment_code having count(*) > 1
  ) then
    raise exception 'Duplicate Gift Card payment code';
  end if;
end $$;

alter table public.gift_card_transactions
  validate constraint gift_card_transaction_actor_or_source;

-- Deliberately do not SET NOT NULL on the pre-existing table in this phase.
-- The unique partial index and application checks protect online lookups.
