-- Phase 2 A1: additive schema only. Apply before any Phase 2 Functions/frontend.
-- The original 00004 file is retained outside supabase/migrations and MUST NOT run.
-- Legacy cards retain unknown purchase provenance (NULL), never assumed cash.
alter table public.gift_cards
  add column purchase_channel text check (purchase_channel in ('online', 'in_store')),
  add column payment_method text check (payment_method in ('cash', 'culqi')),
  add column purchaser_email text,
  add column purchaser_phone text,
  add column delivery_method text check (delivery_method in ('email', 'whatsapp', 'personal')),
  add column culqi_order_id text,
  add column culqi_charge_id text,
  add column online_payment_code text;

-- Only future inserts receive a code. Existing rows are backfilled in A2.
alter table public.gift_cards alter column online_payment_code
  set default encode(extensions.gen_random_bytes(16), 'hex');
create unique index gift_cards_online_payment_code_unique on public.gift_cards(online_payment_code)
  where online_payment_code is not null;
create unique index gift_cards_culqi_order_id_unique on public.gift_cards(culqi_order_id)
  where culqi_order_id is not null;
create unique index gift_cards_culqi_charge_id_unique on public.gift_cards(culqi_charge_id)
  where culqi_charge_id is not null;

create table public.gift_card_purchases (
  checkout_id uuid primary key,
  access_token text not null default encode(extensions.gen_random_bytes(32), 'hex') unique,
  card_id uuid unique references public.gift_cards(id),
  amount numeric(12,2) not null check (amount in (50,75,100,200) or (amount > 100 and amount <= 999999)),
  purchaser_name text not null,
  purchaser_email text not null,
  purchaser_phone text,
  recipient_name text,
  recipient_email text,
  recipient_phone text,
  gift_message text,
  transferable boolean not null,
  delivery_method text not null check (delivery_method in ('email','whatsapp','personal')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','expired')),
  culqi_order_id text unique,
  culqi_charge_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint gift_purchase_delivery check (
    (delivery_method <> 'email' or nullif(btrim(recipient_email),'') is not null)
    and (delivery_method <> 'whatsapp' or nullif(btrim(recipient_phone),'') is not null)
    and (transferable or nullif(btrim(recipient_name),'') is not null)
  )
);
alter table public.gift_card_purchases enable row level security;
revoke all on public.gift_card_purchases from public, anon, authenticated;
grant select, insert, update on public.gift_card_purchases to service_role;

create table public.gift_card_order_payments (
  checkout_id uuid primary key,
  order_id uuid not null unique references public.orders(id),
  gift_card_id uuid not null references public.gift_cards(id),
  gift_amount numeric(12,2) not null check (gift_amount > 0),
  other_amount numeric(12,2) not null check (other_amount >= 0),
  status text not null default 'reserved' check (status in ('reserved','applied','released','refunded')),
  payment_state text not null default 'pending' check (payment_state in
    ('pending','payment_pending','reconciliation_required','paid','failed','expired','released','applied')),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 minutes'),
  culqi_reference text unique,
  applied_at timestamptz,
  refunded_at timestamptz,
  constraint gift_reservation_expiry_after_start check (expires_at > reserved_at)
);
create index gift_card_order_payments_reserved_idx on public.gift_card_order_payments(gift_card_id, expires_at)
  where status = 'reserved';
alter table public.gift_card_order_payments enable row level security;
revoke all on public.gift_card_order_payments from public, anon, authenticated;
grant select, insert, update on public.gift_card_order_payments to service_role;
grant select, insert, update on public.gift_cards, public.gift_card_transactions, public.orders to service_role;
grant usage, select on sequence public.gift_card_code_seq to service_role;

alter table public.gift_card_transactions
  alter column performed_by drop not null,
  add column consumption_channel text not null default 'in_store'
    check (consumption_channel in ('online', 'in_store')),
  add column order_id uuid references public.orders(id),
  add column source_reference text,
  add constraint gift_card_transaction_actor_or_source
    check (performed_by is not null or nullif(btrim(source_reference),'') is not null) not valid;
create unique index gift_card_online_order_redemption_unique on public.gift_card_transactions(order_id)
  where movement_type = 'redemption' and order_id is not null;
create unique index gift_card_order_refund_unique on public.gift_card_transactions(order_id)
  where movement_type = 'refund' and order_id is not null;
alter table public.gift_card_transactions
  drop constraint gift_card_transactions_movement_type_check,
  add constraint gift_card_transactions_movement_type_check
    check (movement_type in ('creation','redemption','block','unblock','refund'));

alter table public.orders
  add column gift_card_id uuid references public.gift_cards(id),
  add column gift_card_amount numeric(12,2) not null default 0 check (gift_card_amount >= 0),
  add column other_payment_amount numeric(12,2) not null default 0 check (other_payment_amount >= 0),
  add column other_payment_method text,
  add column receipt_legal_name text,
  add column gift_card_refund_status text
    check (gift_card_refund_status in ('pending','completed','failed')),
  add column external_payment_refund_status text
    check (external_payment_refund_status in ('pending','completed','failed')),
  add constraint orders_gift_card_split
    check (gift_card_id is null or gift_card_amount + other_payment_amount = total);

-- Existing Fase 1 SELECT policies and order/kitchen policies remain unchanged.
-- RLS and table grants are distinct controls; no direct public table write is added.
