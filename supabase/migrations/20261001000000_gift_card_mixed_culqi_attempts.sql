-- Phase 2 E: persist mixed-payment charge attempts before contacting Culqi.
-- Apply only to the isolated staging project until Phase 2 is approved for production.
create table public.gift_card_culqi_attempts (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null references public.gift_card_order_payments(checkout_id),
  order_id uuid not null references public.orders(id),
  culqi_order_id text not null,
  gift_amount numeric(12,2) not null check (gift_amount > 0),
  culqi_amount numeric(12,2) not null check (culqi_amount > 0),
  status text not null default 'processing' check (status in ('processing','rejected','reconciliation_required','approved','cleared_no_charge')),
  culqi_charge_id text unique,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolution_source text,
  resolution_note text
);
create unique index gift_card_culqi_one_unresolved_attempt
  on public.gift_card_culqi_attempts(order_id)
  where status in ('processing','reconciliation_required');
create index gift_card_culqi_attempts_checkout_idx on public.gift_card_culqi_attempts(checkout_id,created_at desc);
alter table public.gift_card_culqi_attempts enable row level security;
revoke all on public.gift_card_culqi_attempts from public,anon,authenticated;
grant select,insert,update on public.gift_card_culqi_attempts to service_role;

create function public.begin_mixed_culqi_attempt(p_order_id uuid,p_checkout_id uuid,p_culqi_order_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_order public.orders; v_payment public.gift_card_order_payments; v_attempt public.gift_card_culqi_attempts;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  select * into v_payment from public.gift_card_order_payments where order_id=p_order_id for update;
  if v_order.id is null or v_order.checkout_id is distinct from p_checkout_id or v_order.payment_status<>'pending'
     or v_order.culqi_order_id is distinct from p_culqi_order_id or v_payment.status<>'reserved'
     or v_payment.checkout_id is distinct from p_checkout_id or v_payment.other_amount<=0 then
    raise exception 'Mixed payment is not available';
  end if;
  if exists (select 1 from public.gift_card_culqi_attempts where order_id=p_order_id and status in ('processing','reconciliation_required')) then
    raise exception 'Mixed payment attempt needs reconciliation';
  end if;
  insert into public.gift_card_culqi_attempts(checkout_id,order_id,culqi_order_id,gift_amount,culqi_amount)
    values(p_checkout_id,p_order_id,p_culqi_order_id,v_payment.gift_amount,v_payment.other_amount)
    returning * into v_attempt;
  return jsonb_build_object('id',v_attempt.id,'status',v_attempt.status);
end $$;

create function public.mark_mixed_culqi_attempt(p_attempt_id uuid,p_status text,p_source text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_payment public.gift_card_order_payments; v_attempt public.gift_card_culqi_attempts;
begin
  if p_status not in ('rejected','reconciliation_required') then raise exception 'Invalid attempt status'; end if;
  select order_id into v_id from public.gift_card_culqi_attempts where id=p_attempt_id;
  if v_id is null then raise exception 'Attempt not found'; end if;
  perform 1 from public.orders where id=v_id for update;
  select * into v_payment from public.gift_card_order_payments where order_id=v_id for update;
  select * into v_attempt from public.gift_card_culqi_attempts where id=p_attempt_id for update;
  if v_payment.status='applied' and v_attempt.status='approved' then return false; end if;
  if v_payment.status<>'reserved' or v_attempt.status not in ('processing','reconciliation_required') then raise exception 'Attempt cannot be marked'; end if;
  if v_attempt.status='reconciliation_required' and p_status='rejected' then raise exception 'Uncertain attempt cannot become rejected'; end if;
  update public.gift_card_culqi_attempts set status=p_status,resolved_at=case when p_status='rejected' then now() else null end,
    resolution_source=left(p_source,40) where id=p_attempt_id;
  update public.gift_card_order_payments set payment_state=case when p_status='rejected' then 'failed' else 'reconciliation_required' end
    where order_id=v_id;
  return true;
end $$;

create function public.complete_mixed_culqi_attempt(p_order_id uuid,p_attempt_id uuid,p_culqi_reference text,p_charge_id text default null,p_source text default 'charge',p_actor uuid default null,p_note text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_order public.orders; v_payment public.gift_card_order_payments; v_attempt public.gift_card_culqi_attempts; v_result jsonb;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  select * into v_payment from public.gift_card_order_payments where order_id=p_order_id for update;
  select * into v_attempt from public.gift_card_culqi_attempts where id=p_attempt_id for update;
  if v_order.id is null or v_payment.order_id is null or v_attempt.id is null or v_attempt.order_id<>p_order_id
    or v_attempt.checkout_id<>v_order.checkout_id or v_attempt.culqi_order_id is distinct from v_order.culqi_order_id
    or v_attempt.gift_amount<>v_payment.gift_amount or v_attempt.culqi_amount<>v_payment.other_amount
    or p_culqi_reference is null or (p_culqi_reference is distinct from v_order.culqi_order_id and p_culqi_reference is distinct from p_charge_id) then
    raise exception 'Mixed payment confirmation does not match';
  end if;
  if v_attempt.status='approved' and v_payment.status='applied' then
    -- The paid-order webhook can win the race without a charge id. A later,
    -- independently verified charge may attach its id, but never replace one.
    if p_charge_id is not null then
      if p_charge_id !~ '^chr_' or (v_attempt.culqi_charge_id is not null and v_attempt.culqi_charge_id<>p_charge_id)
        or (v_order.culqi_charge_id is not null and v_order.culqi_charge_id<>p_charge_id) then
        raise exception 'Charge reference changed';
      end if;
      update public.orders set culqi_charge_id=p_charge_id where id=p_order_id and culqi_charge_id is null;
      update public.gift_card_culqi_attempts set culqi_charge_id=p_charge_id where id=p_attempt_id and culqi_charge_id is null;
    end if;
    return jsonb_build_object('idempotent',true);
  end if;
  if v_attempt.status not in ('processing','reconciliation_required') or v_payment.status<>'reserved' then
    raise exception 'Mixed payment attempt is not active';
  end if;
  if p_charge_id is not null then
    if p_charge_id !~ '^chr_' or (v_order.culqi_charge_id is not null and v_order.culqi_charge_id<>p_charge_id) then
      raise exception 'Charge reference does not match';
    end if;
    update public.orders set culqi_charge_id=p_charge_id where id=p_order_id;
  end if;
  v_result:=public.apply_gift_card_to_order(p_order_id,p_culqi_reference);
  update public.gift_card_culqi_attempts set status='approved',culqi_charge_id=p_charge_id,resolved_at=now(),
    resolved_by=p_actor,resolution_note=left(nullif(btrim(coalesce(p_note,'')),''),1000),
    resolution_source=left(p_source,40) where id=p_attempt_id;
  return v_result;
end $$;

-- This is the final release gate, including calls from future code paths.
create or replace function public.release_gift_card_order_reservation(p_order_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_order public.orders; v_payment public.gift_card_order_payments;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then return false; end if;
  select * into v_payment from public.gift_card_order_payments where order_id=p_order_id for update;
  if not found or v_payment.status<>'reserved' then return false; end if;
  if v_payment.other_amount>0 and exists (
    select 1 from public.gift_card_culqi_attempts where order_id=p_order_id and status in ('processing','reconciliation_required')
  ) then raise exception 'Conciliar intento Culqi antes de liberar'; end if;
  if v_payment.other_amount>0 and v_order.culqi_charge_id is not null then
    raise exception 'Conciliar cargo Culqi antes de liberar';
  end if;
  if v_payment.other_amount>0 and v_order.culqi_order_id is not null and v_payment.payment_state<>'expired' then
    raise exception 'Confirmar vencimiento Culqi antes de liberar';
  end if;
  update public.gift_card_order_payments set status='released',payment_state='released' where order_id=p_order_id;
  return true;
end $$;

create function public.clear_mixed_culqi_attempt(p_order_id uuid,p_attempt_id uuid,p_actor uuid,p_note text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_order public.orders; v_payment public.gift_card_order_payments; v_attempt public.gift_card_culqi_attempts;
begin
  if p_actor is null or length(btrim(coalesce(p_note,'')))<12 then raise exception 'Audited decision required'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  select * into v_payment from public.gift_card_order_payments where order_id=p_order_id for update;
  select * into v_attempt from public.gift_card_culqi_attempts where id=p_attempt_id for update;
  if v_attempt.status='cleared_no_charge' and v_payment.status='released' then return true; end if;
  if v_order.id is null or v_attempt.order_id<>p_order_id or v_payment.status<>'reserved'
    or v_attempt.status not in ('processing','reconciliation_required') or v_order.culqi_charge_id is not null then
    raise exception 'Attempt cannot be cleared';
  end if;
  update public.gift_card_culqi_attempts set status='cleared_no_charge',resolved_at=now(),resolved_by=p_actor,
    resolution_source='manual',resolution_note=left(btrim(p_note),1000) where id=p_attempt_id;
  update public.gift_card_order_payments set payment_state='expired' where order_id=p_order_id;
  update public.orders set payment_status='expired' where id=p_order_id;
  return public.release_gift_card_order_reservation(p_order_id);
end $$;

revoke all on function public.begin_mixed_culqi_attempt(uuid,uuid,text),
  public.mark_mixed_culqi_attempt(uuid,text,text),
  public.complete_mixed_culqi_attempt(uuid,uuid,text,text,text,uuid,text),
  public.clear_mixed_culqi_attempt(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.begin_mixed_culqi_attempt(uuid,uuid,text),
  public.mark_mixed_culqi_attempt(uuid,text,text),
  public.complete_mixed_culqi_attempt(uuid,uuid,text,text,text,uuid,text),
  public.clear_mixed_culqi_attempt(uuid,uuid,uuid,text) to service_role;
