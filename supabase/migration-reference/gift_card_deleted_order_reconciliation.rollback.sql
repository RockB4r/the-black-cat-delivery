-- Restores the pre-fix RPC only. Apply ONLY after reverting the companion backend.
-- Does not undo any audited cleared_no_charge resolution or recreate released reservations.
create or replace function public.clear_mixed_culqi_attempt(p_order_id uuid,p_attempt_id uuid,p_actor uuid,p_note text)
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
