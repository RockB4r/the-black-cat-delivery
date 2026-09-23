-- Online gift purchases and consumption payments. No public table grants.
alter table public.gift_cards
  add column purchase_channel text not null default 'in_store' check (purchase_channel in ('online', 'in_store')),
  add column payment_method text not null default 'cash' check (payment_method in ('cash', 'culqi')),
  add column purchaser_email text,
  add column purchaser_phone text,
  add column delivery_method text check (delivery_method in ('email', 'whatsapp', 'personal')),
  add column culqi_order_id text unique,
  add column culqi_charge_id text unique,
  add column online_payment_code text not null default encode(extensions.gen_random_bytes(16), 'hex') unique;

alter table public.gift_card_transactions
  alter column performed_by drop not null,
  add column consumption_channel text not null default 'in_store' check (consumption_channel in ('online', 'in_store')),
  add column order_id uuid references public.orders(id);
create unique index gift_card_online_order_redemption_unique on public.gift_card_transactions(order_id)
  where movement_type = 'redemption' and order_id is not null;

alter table public.orders
  add column gift_card_id uuid references public.gift_cards(id),
  add column gift_card_amount numeric(12,2) not null default 0 check (gift_card_amount >= 0),
  add column other_payment_amount numeric(12,2) not null default 0 check (other_payment_amount >= 0),
  add column other_payment_method text,
  add column receipt_legal_name text,
  add constraint orders_gift_card_split check (gift_card_id is null or gift_card_amount + other_payment_amount = total);

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
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  refunded_at timestamptz
);
create index gift_card_order_payments_reserved_idx on public.gift_card_order_payments(gift_card_id)
  where status = 'reserved';
alter table public.gift_card_order_payments enable row level security;
revoke all on public.gift_card_order_payments from public, anon, authenticated;
grant select, insert, update on public.gift_card_order_payments to service_role;
grant select, insert, update on public.gift_cards, public.gift_card_transactions, public.orders to service_role;
grant usage on sequence public.gift_card_code_seq to service_role;

-- Only Netlify Functions with the private service role may invoke these RPCs.
create function public.finalize_gift_card_purchase(p_checkout_id uuid, p_culqi_order_id text, p_culqi_charge_id text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_purchase public.gift_card_purchases; v_card public.gift_cards;
begin
  select * into v_purchase from public.gift_card_purchases where checkout_id = p_checkout_id for update;
  if not found or v_purchase.culqi_order_id is distinct from p_culqi_order_id then raise exception 'Compra no encontrada'; end if;
  if v_purchase.payment_status = 'paid' then
    select * into v_card from public.gift_cards where id = v_purchase.card_id;
    return jsonb_build_object('code',v_card.code,'token',v_card.qr_token,'payment_code',v_card.online_payment_code,'amount',v_card.initial_balance,'activated_at',v_card.activated_at,'expires_at',v_card.expires_at,'purchaser_name',v_card.purchaser_name,'recipient_name',v_card.recipient_name,'payment_method','culqi');
  end if;
  if v_purchase.payment_status <> 'pending' then raise exception 'Compra no disponible'; end if;
  if p_culqi_order_id is null and nullif(btrim(p_culqi_charge_id),'') is null then raise exception 'Cargo Culqi obligatorio'; end if;
  insert into public.gift_cards (
    code,initial_balance,current_balance,status,purchaser_name,purchaser_email,purchaser_phone,
    recipient_name,recipient_email,recipient_phone,gift_message,transferable,delivery_method,
    activated_at,expires_at,purchase_channel,payment_method,culqi_order_id,culqi_charge_id
  ) values (
    'BC-GC-' || lpad(nextval('public.gift_card_code_seq')::text,6,'0'),
    v_purchase.amount,v_purchase.amount,'active',v_purchase.purchaser_name,v_purchase.purchaser_email,v_purchase.purchaser_phone,
    v_purchase.recipient_name,v_purchase.recipient_email,v_purchase.recipient_phone,v_purchase.gift_message,v_purchase.transferable,v_purchase.delivery_method,
    now(),now() + interval '45 days','online','culqi',p_culqi_order_id,p_culqi_charge_id
  ) returning * into v_card;
  insert into public.gift_card_transactions(gift_card_id,movement_type,amount,balance_before,balance_after,reference,consumption_channel)
    values (v_card.id,'creation',v_card.initial_balance,0,v_card.initial_balance,p_checkout_id::text,'online');
  update public.gift_card_purchases set card_id=v_card.id,payment_status='paid',paid_at=now(),culqi_charge_id=p_culqi_charge_id where checkout_id=p_checkout_id;
  return jsonb_build_object('code',v_card.code,'token',v_card.qr_token,'payment_code',v_card.online_payment_code,'amount',v_card.initial_balance,'activated_at',v_card.activated_at,'expires_at',v_card.expires_at,'purchaser_name',v_card.purchaser_name,'recipient_name',v_card.recipient_name,'payment_method','culqi');
end $$;

create function public.reserve_gift_card_for_order(p_order_id uuid, p_checkout_id uuid, p_payment_code text, p_recipient_name text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_order public.orders; v_card public.gift_cards; v_existing public.gift_card_order_payments; v_reserved numeric(12,2); v_amount numeric(12,2);
begin
  select * into v_order from public.orders where id=p_order_id and checkout_id=p_checkout_id for update;
  if not found or v_order.payment_status <> 'pending' then raise exception 'Pedido no disponible'; end if;
  select * into v_existing from public.gift_card_order_payments where checkout_id=p_checkout_id;
  if found then
    if v_existing.order_id <> p_order_id or v_existing.status <> 'reserved' then raise exception 'Reserva no disponible'; end if;
    select * into v_card from public.gift_cards where id=v_existing.gift_card_id;
    if v_card.online_payment_code <> p_payment_code then raise exception 'Código no coincide'; end if;
    return jsonb_build_object('gift_amount',v_existing.gift_amount,'other_amount',v_existing.other_amount,'gift_card_id',v_card.id);
  end if;
  select * into v_card from public.gift_cards where online_payment_code=p_payment_code for update;
  if not found or v_card.status <> 'active' or v_card.expires_at <= now() or v_card.current_balance <= 0 then raise exception 'Gift Card no disponible'; end if;
  if not v_card.transferable and lower(btrim(coalesce(p_recipient_name,''))) <> lower(btrim(v_card.recipient_name)) then raise exception 'Verifica identidad del beneficiario'; end if;
  select coalesce(sum(gift_amount),0) into v_reserved from public.gift_card_order_payments where gift_card_id=v_card.id and status='reserved';
  v_amount := least(v_order.total, v_card.current_balance-v_reserved);
  if v_amount <= 0 then raise exception 'Saldo no disponible'; end if;
  if v_order.total > v_amount and v_card.expires_at <= now() + interval '65 minutes' then raise exception 'Gift Card demasiado próxima al vencimiento para pago mixto'; end if;
  insert into public.gift_card_order_payments(checkout_id,order_id,gift_card_id,gift_amount,other_amount)
    values (p_checkout_id,p_order_id,v_card.id,v_amount,v_order.total-v_amount);
  update public.orders set gift_card_id=v_card.id,gift_card_amount=v_amount,other_payment_amount=v_order.total-v_amount,
    payment_method=case when v_order.total=v_amount then 'gift_card' else 'gift_card_culqi' end,
    other_payment_method=case when v_order.total=v_amount then null else 'culqi' end
    where id=p_order_id;
  return jsonb_build_object('gift_amount',v_amount,'other_amount',v_order.total-v_amount,'gift_card_id',v_card.id);
end $$;

create function public.apply_gift_card_to_order(p_order_id uuid, p_culqi_reference text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_order public.orders; v_payment public.gift_card_order_payments; v_card public.gift_cards;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  select * into v_payment from public.gift_card_order_payments where order_id=p_order_id for update;
  if not found then raise exception 'Reserva no encontrada'; end if;
  if v_payment.status='applied' then
    return jsonb_build_object('gift_amount',v_payment.gift_amount,'other_amount',v_payment.other_amount,'idempotent',true);
  end if;
  if v_payment.status<>'reserved' or v_order.status in ('cancelado','rechazado') then raise exception 'Reserva no disponible'; end if;
  if v_payment.other_amount>0 and (nullif(btrim(p_culqi_reference),'') is null or v_order.culqi_order_id is null) then raise exception 'Pago complementario no confirmado'; end if;
  if v_payment.other_amount=0 and p_culqi_reference is not null then raise exception 'Referencia inesperada'; end if;
  select * into v_card from public.gift_cards where id=v_payment.gift_card_id for update;
  if v_card.status<>'active' or v_card.expires_at <= now() or v_card.current_balance < v_payment.gift_amount then raise exception 'Gift Card no disponible'; end if;
  update public.gift_cards set current_balance=current_balance-v_payment.gift_amount,
    status=case when current_balance=v_payment.gift_amount then 'exhausted' else 'active' end where id=v_card.id;
  insert into public.gift_card_transactions(gift_card_id,movement_type,amount,balance_before,balance_after,reference,consumption_channel,order_id)
    values (v_card.id,'redemption',-v_payment.gift_amount,v_card.current_balance,v_card.current_balance-v_payment.gift_amount,v_order.order_number,'online',p_order_id);
  update public.gift_card_order_payments set status='applied',applied_at=now() where order_id=p_order_id;
  update public.orders set payment_status='paid' where id=p_order_id;
  return jsonb_build_object('gift_amount',v_payment.gift_amount,'other_amount',v_payment.other_amount,'idempotent',false);
end $$;

-- Protect online reservations from in-store redemptions and blocking.
create or replace function public.redeem_gift_card(
  p_card_id uuid, p_consumption_amount numeric, p_reference text, p_recipient_name text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_card public.gift_cards; v_debit numeric(12,2); v_prior public.gift_card_transactions; v_reserved numeric(12,2);
begin
  if private.gift_card_staff_role() is null then raise exception 'No autorizado'; end if;
  if p_consumption_amount is null or p_consumption_amount <= 0 or p_consumption_amount <> round(p_consumption_amount, 2) or p_consumption_amount > 999999 then raise exception 'Monto inválido'; end if;
  if nullif(btrim(p_reference), '') is null or length(p_reference) > 120 then raise exception 'Referencia obligatoria'; end if;
  select * into v_card from public.gift_cards where id = p_card_id for update;
  if not found then raise exception 'Gift Card no encontrada'; end if;
  select * into v_prior from public.gift_card_transactions where gift_card_id = p_card_id and movement_type = 'redemption' and reference = p_reference;
  if found then return jsonb_build_object('debited', -v_prior.amount, 'remaining_to_pay', greatest(p_consumption_amount + v_prior.amount, 0), 'balance', v_prior.balance_after, 'idempotent', true); end if;
  if v_card.status <> 'active' or v_card.expires_at <= now() or v_card.current_balance <= 0 then raise exception 'Gift Card no disponible'; end if;
  if not v_card.transferable and lower(btrim(coalesce(p_recipient_name,''))) <> lower(btrim(v_card.recipient_name)) then raise exception 'Verifica identidad del beneficiario'; end if;
  select coalesce(sum(gift_amount),0) into v_reserved from public.gift_card_order_payments where gift_card_id=p_card_id and status='reserved';
  v_debit := least(v_card.current_balance-v_reserved, p_consumption_amount);
  if v_debit <= 0 then raise exception 'Saldo reservado para otro pedido'; end if;
  update public.gift_cards set current_balance = current_balance - v_debit,
    status = case when current_balance - v_debit = 0 then 'exhausted' else 'active' end where id = p_card_id;
  insert into public.gift_card_transactions(gift_card_id, movement_type, amount, balance_before, balance_after, reference, performed_by, consumption_channel)
    values (p_card_id, 'redemption', -v_debit, v_card.current_balance, v_card.current_balance - v_debit, p_reference, auth.uid(), 'in_store');
  return jsonb_build_object('debited', v_debit, 'remaining_to_pay', p_consumption_amount - v_debit, 'balance', v_card.current_balance - v_debit, 'idempotent', false);
end $$;

create or replace function public.block_gift_card(p_card_id uuid)
returns public.gift_cards language plpgsql security definer set search_path = '' as $$
declare v_card public.gift_cards; v_reserved numeric(12,2);
begin
  if private.gift_card_staff_role() not in ('manager','admin') then raise exception 'No autorizado'; end if;
  select * into v_card from public.gift_cards where id = p_card_id for update;
  if not found or v_card.status <> 'active' or v_card.expires_at <= now() then raise exception 'Solo se puede bloquear una Gift Card activa'; end if;
  select coalesce(sum(gift_amount),0) into v_reserved from public.gift_card_order_payments where gift_card_id=p_card_id and status='reserved';
  if v_reserved > 0 then raise exception 'Esta Gift Card tiene un pago en curso'; end if;
  update public.gift_cards set status = 'blocked', blocked_at = now(), blocked_by = auth.uid() where id = p_card_id returning * into v_card;
  insert into public.gift_card_transactions(gift_card_id, movement_type, amount, balance_before, balance_after, performed_by)
    values (p_card_id, 'block', 0, v_card.current_balance, v_card.current_balance, auth.uid());
  return v_card;
end $$;

create function public.release_gift_card_order_reservation(p_order_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_order public.orders;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then return false; end if;
  update public.gift_card_order_payments set status='released' where order_id=p_order_id and status='reserved';
  return found;
end $$;

alter table public.gift_card_transactions drop constraint gift_card_transactions_movement_type_check;
alter table public.gift_card_transactions add constraint gift_card_transactions_movement_type_check
  check (movement_type in ('creation','redemption','block','unblock','refund'));
create unique index gift_card_order_refund_unique on public.gift_card_transactions(order_id)
  where movement_type='refund' and order_id is not null;

-- Rejection and balance restoration are one database transaction. For a mixed
-- payment the Culqi complement still requires a separate merchant refund.
create function public.reject_gift_card_order(p_order_id uuid,p_reason text,p_comment text,p_rejected_by text,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_order public.orders; v_payment public.gift_card_order_payments; v_card public.gift_cards;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.status<>'nuevo' then raise exception 'Pedido no disponible para rechazo'; end if;
  select * into v_payment from public.gift_card_order_payments where order_id=p_order_id for update;
  if not found then raise exception 'Pago Gift Card no encontrado'; end if;
  if v_payment.status='applied' then
    select * into v_card from public.gift_cards where id=v_payment.gift_card_id for update;
    update public.gift_cards set current_balance=current_balance+v_payment.gift_amount,
      status=case when v_card.status='blocked' then 'blocked' when expires_at<=now() then 'expired' else 'active' end where id=v_card.id;
    insert into public.gift_card_transactions(gift_card_id,movement_type,amount,balance_before,balance_after,reference,performed_by,consumption_channel,order_id)
      values(v_card.id,'refund',v_payment.gift_amount,v_card.current_balance,v_card.current_balance+v_payment.gift_amount,v_order.order_number,p_actor,'online',p_order_id);
    update public.gift_card_order_payments set status='refunded',refunded_at=now() where order_id=p_order_id;
  elsif v_payment.status='reserved' then
    if v_payment.other_amount>0 then raise exception 'Pago mixto todavía pendiente'; end if;
    update public.gift_card_order_payments set status='released' where order_id=p_order_id;
  else
    raise exception 'Pago Gift Card no disponible';
  end if;
  update public.orders set status='rechazado',rejection_reason=p_reason,rejection_comment=nullif(btrim(coalesce(p_comment,'')),''),
    rejected_at=now(),rejected_by=p_rejected_by,
    payment_status=case when v_payment.status='reserved' then 'failed' when v_payment.other_amount>0 then 'refund_pending' else 'refunded' end
    where id=p_order_id;
  return jsonb_build_object('gift_restored',v_payment.status='applied','culqi_refund_required',v_payment.other_amount>0 and v_payment.status='applied');
end $$;

revoke all on function public.finalize_gift_card_purchase(uuid,text,text), public.reserve_gift_card_for_order(uuid,uuid,text,text), public.apply_gift_card_to_order(uuid,text), public.release_gift_card_order_reservation(uuid), public.reject_gift_card_order(uuid,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.finalize_gift_card_purchase(uuid,text,text), public.reserve_gift_card_for_order(uuid,uuid,text,text), public.apply_gift_card_to_order(uuid,text), public.release_gift_card_order_reservation(uuid), public.reject_gift_card_order(uuid,text,text,text,uuid) to service_role;

-- Preserve the existing atomic order/item implementation and extend it with
-- the legal name needed by a later invoice integration.
alter function public.create_kitchen_order_with_items(jsonb,jsonb) rename to create_kitchen_order_with_items_legacy;
revoke all on function public.create_kitchen_order_with_items_legacy(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_kitchen_order_with_items_legacy(jsonb,jsonb) to service_role;
create function public.create_kitchen_order_with_items(p_order jsonb,p_items jsonb)
returns table(order_id uuid,order_number text,created boolean)
language plpgsql security definer set search_path = '' as $$
begin
  return query select r.order_id,r.order_number,r.created from public.create_kitchen_order_with_items_legacy(p_order,p_items) r;
  update public.orders o set receipt_legal_name=nullif(btrim(p_order ->> 'receipt_legal_name'),'')
    where o.checkout_id=(p_order ->> 'checkout_id')::uuid
      and o.receipt_legal_name is null
      and p_order ->> 'receipt_type' = 'factura';
end $$;
revoke all on function public.create_kitchen_order_with_items(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_kitchen_order_with_items(jsonb,jsonb) to service_role;
