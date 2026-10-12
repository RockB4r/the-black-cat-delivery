-- Phase 2 B: server-only RPCs. All privileged calls use the Netlify service role.
-- Culqi verification is performed server-to-server BEFORE these RPCs are invoked.
-- No SECURITY DEFINER is needed: service_role has explicit table privileges.

create function public.finalize_gift_card_purchase(p_checkout_id uuid, p_culqi_order_id text, p_culqi_charge_id text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_purchase public.gift_card_purchases; v_card public.gift_cards;
begin
  select * into v_purchase from public.gift_card_purchases where checkout_id=p_checkout_id for update;
  if not found or v_purchase.culqi_order_id is distinct from p_culqi_order_id then raise exception 'Compra no encontrada'; end if;
  if v_purchase.payment_status='paid' then
    select * into v_card from public.gift_cards where id=v_purchase.card_id;
    return jsonb_build_object('code',v_card.code,'token',v_card.qr_token,'payment_code',v_card.online_payment_code,
      'amount',v_card.initial_balance,'activated_at',v_card.activated_at,'expires_at',v_card.expires_at,
      'purchaser_name',v_card.purchaser_name,'recipient_name',v_card.recipient_name,'payment_method','culqi');
  end if;
  if v_purchase.payment_status<>'pending' then raise exception 'Compra no disponible'; end if;
  if p_culqi_order_id is null and nullif(btrim(p_culqi_charge_id),'') is null then raise exception 'Confirmación Culqi obligatoria'; end if;
  if p_culqi_charge_id is not null and v_purchase.culqi_charge_id is distinct from p_culqi_charge_id then
    raise exception 'Referencia Culqi no coincide';
  end if;
  insert into public.gift_cards (
    code,initial_balance,current_balance,status,purchaser_name,purchaser_email,purchaser_phone,
    recipient_name,recipient_email,recipient_phone,gift_message,transferable,delivery_method,
    activated_at,expires_at,purchase_channel,payment_method,culqi_order_id,culqi_charge_id
  ) values (
    'BC-GC-' || lpad(nextval('public.gift_card_code_seq')::text,6,'0'),
    v_purchase.amount,v_purchase.amount,'active',v_purchase.purchaser_name,v_purchase.purchaser_email,v_purchase.purchaser_phone,
    v_purchase.recipient_name,v_purchase.recipient_email,v_purchase.recipient_phone,v_purchase.gift_message,
    v_purchase.transferable,v_purchase.delivery_method,now(),now()+interval '45 days',
    'online','culqi',p_culqi_order_id,p_culqi_charge_id
  ) returning * into v_card;
  insert into public.gift_card_transactions
    (gift_card_id,movement_type,amount,balance_before,balance_after,reference,consumption_channel,source_reference)
  values (v_card.id,'creation',v_card.initial_balance,0,v_card.initial_balance,p_checkout_id::text,
    'online','gift_purchase:' || p_checkout_id::text);
  update public.gift_card_purchases set card_id=v_card.id,payment_status='paid',paid_at=now(),
    culqi_charge_id=coalesce(p_culqi_charge_id,culqi_charge_id) where checkout_id=p_checkout_id;
  return jsonb_build_object('code',v_card.code,'token',v_card.qr_token,'payment_code',v_card.online_payment_code,
    'amount',v_card.initial_balance,'activated_at',v_card.activated_at,'expires_at',v_card.expires_at,
    'purchaser_name',v_card.purchaser_name,'recipient_name',v_card.recipient_name,'payment_method','culqi');
end $$;

create function public.reserve_gift_card_for_order(p_order_id uuid,p_checkout_id uuid,p_payment_code text,p_recipient_name text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_order public.orders; v_card public.gift_cards; v_existing public.gift_card_order_payments;
  v_reserved numeric(12,2); v_amount numeric(12,2);
begin
  select * into v_order from public.orders where id=p_order_id and checkout_id=p_checkout_id for update;
  if not found or v_order.payment_status<>'pending' then raise exception 'Pedido no disponible'; end if;
  select * into v_existing from public.gift_card_order_payments where checkout_id=p_checkout_id for update;
  if found then
    if v_existing.order_id<>p_order_id or v_existing.status<>'reserved' then raise exception 'Reserva no disponible'; end if;
    select * into v_card from public.gift_cards where id=v_existing.gift_card_id;
    if v_card.online_payment_code is distinct from p_payment_code then raise exception 'Código no coincide'; end if;
    if v_existing.expires_at<=now() then
      -- A mixed reservation with a Culqi order must be reconciled by Netlify first.
      if v_existing.other_amount>0 and (v_order.culqi_order_id is not null or v_order.culqi_charge_id is not null) then
        return jsonb_build_object('reconciliation_required',true);
      end if;
      update public.gift_card_order_payments set status='released',payment_state='released' where checkout_id=p_checkout_id;
      return jsonb_build_object('expired',true);
    end if;
    return jsonb_build_object('gift_amount',v_existing.gift_amount,'other_amount',v_existing.other_amount,'gift_card_id',v_card.id);
  end if;
  select * into v_card from public.gift_cards where online_payment_code=p_payment_code for update;
  if not found or v_card.status<>'active' or v_card.expires_at<=now() or v_card.current_balance<=0 then
    raise exception 'Gift Card no disponible';
  end if;
  if not v_card.transferable and lower(btrim(coalesce(p_recipient_name,'')))<>lower(btrim(v_card.recipient_name)) then
    raise exception 'Verifica identidad del beneficiario';
  end if;
  -- Expired reservations are reconciled by the server before this RPC. Never
  -- release another order here: it could race an in-flight Culqi confirmation.
  select coalesce(sum(gift_amount),0) into v_reserved from public.gift_card_order_payments
    where gift_card_id=v_card.id and status='reserved';
  v_amount:=least(v_order.total,v_card.current_balance-v_reserved);
  if v_amount<=0 then raise exception 'Saldo no disponible o pendiente de conciliación'; end if;
  if v_order.total>v_amount and v_card.expires_at<=now()+interval '95 minutes' then
    raise exception 'Gift Card demasiado próxima al vencimiento para pago mixto';
  end if;
  insert into public.gift_card_order_payments(checkout_id,order_id,gift_card_id,gift_amount,other_amount)
    values(p_checkout_id,p_order_id,v_card.id,v_amount,v_order.total-v_amount);
  update public.orders set gift_card_id=v_card.id,gift_card_amount=v_amount,other_payment_amount=v_order.total-v_amount,
    payment_method=case when v_order.total=v_amount then 'gift_card' else 'gift_card_culqi' end,
    other_payment_method=case when v_order.total=v_amount then null else 'culqi' end where id=p_order_id;
  return jsonb_build_object('gift_amount',v_amount,'other_amount',v_order.total-v_amount,'gift_card_id',v_card.id);
end $$;

create function public.apply_gift_card_to_order(p_order_id uuid,p_culqi_reference text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_order public.orders; v_payment public.gift_card_order_payments; v_card public.gift_cards;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  select * into v_payment from public.gift_card_order_payments where order_id=p_order_id for update;
  if not found then raise exception 'Reserva no encontrada'; end if;
  if v_payment.status='applied' then
    if v_payment.culqi_reference is distinct from p_culqi_reference then raise exception 'Referencia no coincide'; end if;
    return jsonb_build_object('gift_amount',v_payment.gift_amount,'other_amount',v_payment.other_amount,'idempotent',true);
  end if;
  if v_payment.status<>'reserved' or v_order.status in ('cancelado','rechazado') then raise exception 'Reserva no disponible'; end if;
  if v_payment.other_amount>0 then
    if nullif(btrim(p_culqi_reference),'') is null
      or (p_culqi_reference is distinct from v_order.culqi_charge_id
        and p_culqi_reference is distinct from v_order.culqi_order_id)
    then raise exception 'Referencia Culqi no coincide con el pedido'; end if;
  elsif p_culqi_reference is not null or v_payment.expires_at<=now() then
    raise exception 'Reserva Gift Card vencida o referencia inesperada';
  end if;
  select * into v_card from public.gift_cards where id=v_payment.gift_card_id for update;
  if v_card.status<>'active' or v_card.expires_at<=now() or v_card.current_balance<v_payment.gift_amount then
    raise exception 'Gift Card no disponible';
  end if;
  update public.gift_cards set current_balance=current_balance-v_payment.gift_amount,
    status=case when current_balance=v_payment.gift_amount then 'exhausted' else 'active' end where id=v_card.id;
  insert into public.gift_card_transactions
    (gift_card_id,movement_type,amount,balance_before,balance_after,reference,consumption_channel,order_id,source_reference)
  values(v_card.id,'redemption',-v_payment.gift_amount,v_card.current_balance,
    v_card.current_balance-v_payment.gift_amount,v_order.order_number,'online',p_order_id,
    'online_order:' || p_order_id::text);
  update public.gift_card_order_payments set status='applied',payment_state='applied',applied_at=now(),culqi_reference=p_culqi_reference
    where order_id=p_order_id;
  update public.orders set payment_status='paid' where id=p_order_id;
  return jsonb_build_object('gift_amount',v_payment.gift_amount,'other_amount',v_payment.other_amount,'idempotent',false);
end $$;

create function public.release_gift_card_order_reservation(p_order_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_order public.orders; v_payment public.gift_card_order_payments;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then return false; end if;
  select * into v_payment from public.gift_card_order_payments where order_id=p_order_id for update;
  if not found or v_payment.status<>'reserved' then return false; end if;
  -- An order expiration does not prove a separate card charge was declined.
  -- Keep linked charges reserved for manual reconciliation if not approved.
  if v_payment.other_amount>0 and v_order.culqi_charge_id is not null then
    raise exception 'Conciliar cargo Culqi antes de liberar';
  end if;
  if v_payment.other_amount>0 and v_order.culqi_order_id is not null
    and v_payment.payment_state<>'expired' then
    raise exception 'Confirmar vencimiento Culqi antes de liberar';
  end if;
  update public.gift_card_order_payments set status='released',payment_state='released' where order_id=p_order_id;
  return true;
end $$;

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
      status=case when v_card.status='blocked' then 'blocked' when expires_at<=now() then 'expired' else 'active' end
      where id=v_card.id;
    insert into public.gift_card_transactions
      (gift_card_id,movement_type,amount,balance_before,balance_after,reference,performed_by,consumption_channel,order_id,source_reference)
    values(v_card.id,'refund',v_payment.gift_amount,v_card.current_balance,
      v_card.current_balance+v_payment.gift_amount,v_order.order_number,p_actor,'online',p_order_id,
      'rejected_order:' || p_order_id::text);
    update public.gift_card_order_payments set status='refunded',refunded_at=now() where order_id=p_order_id;
  elsif v_payment.status='reserved' then
    if v_payment.other_amount>0 then raise exception 'Pago mixto todavía pendiente'; end if;
    update public.gift_card_order_payments set status='released',payment_state='released' where order_id=p_order_id;
  else raise exception 'Pago Gift Card no disponible';
  end if;
  update public.orders set status='rechazado',rejection_reason=p_reason,
    rejection_comment=nullif(btrim(coalesce(p_comment,'')),''),
    rejected_at=now(),rejected_by=p_rejected_by,
    gift_card_refund_status=case when v_payment.status='applied' then 'completed' else null end,
    external_payment_refund_status=case when v_payment.status='applied' and v_payment.other_amount>0 then 'pending' else null end,
    payment_status=case when v_payment.status='reserved' then 'failed'
      when v_payment.other_amount>0 then 'refund_pending' else 'refunded' end
    where id=p_order_id;
  return jsonb_build_object('gift_restored',v_payment.status='applied',
    'culqi_refund_required',v_payment.other_amount>0 and v_payment.status='applied');
end $$;

revoke all on function public.finalize_gift_card_purchase(uuid,text,text),
  public.reserve_gift_card_for_order(uuid,uuid,text,text),
  public.apply_gift_card_to_order(uuid,text),
  public.release_gift_card_order_reservation(uuid),
  public.reject_gift_card_order(uuid,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_gift_card_purchase(uuid,text,text),
  public.reserve_gift_card_for_order(uuid,uuid,text,text),
  public.apply_gift_card_to_order(uuid,text),
  public.release_gift_card_order_reservation(uuid),
  public.reject_gift_card_order(uuid,text,text,text,uuid) to service_role;
