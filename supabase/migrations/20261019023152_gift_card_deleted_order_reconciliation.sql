-- Staging first. Manual no-charge resolution only; no automatic cleanup changes.
-- CREATE OR REPLACE preserves owner/ACL; signature and SECURITY INVOKER stay unchanged.
create or replace function public.clear_mixed_culqi_attempt(p_order_id uuid,p_attempt_id uuid,p_actor uuid,p_note text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare
  v_order public.orders;
  v_payment public.gift_card_order_payments;
  v_attempt public.gift_card_culqi_attempts;
  v_released boolean;
begin
  if p_actor is null or length(btrim(coalesce(p_note,'')))<12 then raise exception 'Audited decision required'; end if;
  -- Same lock order as begin/complete/mark/release: order, reservation, attempt.
  select * into v_order from public.orders where id=p_order_id for update;
  select * into v_payment from public.gift_card_order_payments where order_id=p_order_id for update;
  select * into v_attempt from public.gift_card_culqi_attempts where id=p_attempt_id for update;
  if v_order.id is null or v_payment.order_id is null or v_attempt.id is null
    or v_attempt.order_id is distinct from p_order_id
    or v_attempt.checkout_id is distinct from v_order.checkout_id
    or v_payment.checkout_id is distinct from v_order.checkout_id
    or v_payment.gift_card_id is distinct from v_order.gift_card_id
    or v_attempt.culqi_order_id is distinct from v_order.culqi_order_id
    or v_attempt.gift_amount is distinct from v_payment.gift_amount
    or v_attempt.culqi_amount is distinct from v_payment.other_amount
    or v_order.gift_card_amount is distinct from v_payment.gift_amount
    or v_order.other_payment_amount is distinct from v_payment.other_amount
    or v_order.total is distinct from v_payment.gift_amount+v_payment.other_amount
    or v_order.payment_status not in ('pending','failed','expired')
    or v_order.culqi_charge_id is not null then
    raise exception 'Attempt cannot be cleared';
  end if;
  if exists(select 1 from public.gift_card_transactions t where t.order_id=p_order_id and t.movement_type='redemption')
    or exists(select 1 from public.gift_card_culqi_attempts a where a.order_id=p_order_id
      and (a.status='approved' or (a.id<>p_attempt_id and a.status in ('processing','reconciliation_required')))) then
    raise exception 'Attempt cannot be cleared';
  end if;
  if v_attempt.status='cleared_no_charge' and v_payment.status='released'
    and v_payment.payment_state='released' and v_order.payment_status='expired' then return true; end if;
  if v_payment.status<>'reserved' or v_payment.payment_state in ('paid','applied')
    or v_attempt.status not in ('processing','reconciliation_required','rejected') then
    raise exception 'Attempt cannot be cleared';
  end if;
  update public.gift_card_culqi_attempts set status='cleared_no_charge',resolved_at=now(),resolved_by=p_actor,
    resolution_source='manual',
    resolution_note=left('previous_status='||v_attempt.status||'; previous_source='||coalesce(v_attempt.resolution_source,'none')||'; '||btrim(p_note),1000)
    where id=p_attempt_id;
  update public.gift_card_order_payments set payment_state='expired' where order_id=p_order_id;
  update public.orders set payment_status='expired' where id=p_order_id;
  v_released:=public.release_gift_card_order_reservation(p_order_id);
  if v_released is distinct from true then raise exception 'Reservation release was not confirmed'; end if;
  return true;
end $$;
