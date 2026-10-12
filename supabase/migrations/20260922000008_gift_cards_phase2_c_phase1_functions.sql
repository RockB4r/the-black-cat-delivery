-- Phase 2 C: preserve Fase 1 RPCs while respecting online reservations.
-- Exact pre-Phase-2 definitions are in:
-- 20260922000000_gift_cards_phase1.sql and 20260922000002_gift_card_null_role_guard.sql.

create or replace function public.redeem_gift_card(
  p_card_id uuid,p_consumption_amount numeric,p_reference text,p_recipient_name text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_card public.gift_cards; v_debit numeric(12,2);
  v_prior public.gift_card_transactions; v_reserved numeric(12,2);
begin
  if private.gift_card_staff_role() is null then raise exception 'No autorizado'; end if;
  if p_consumption_amount is null or p_consumption_amount<=0
    or p_consumption_amount<>round(p_consumption_amount,2)
    or p_consumption_amount>999999 then raise exception 'Monto inválido'; end if;
  if nullif(btrim(p_reference),'') is null or length(p_reference)>120 then raise exception 'Referencia obligatoria'; end if;
  select * into v_card from public.gift_cards where id=p_card_id for update;
  if not found then raise exception 'Gift Card no encontrada'; end if;
  select * into v_prior from public.gift_card_transactions
    where gift_card_id=p_card_id and movement_type='redemption' and reference=p_reference;
  if found then
    return jsonb_build_object('debited',-v_prior.amount,
      'remaining_to_pay',greatest(p_consumption_amount+v_prior.amount,0),
      'balance',v_prior.balance_after,'idempotent',true);
  end if;
  if v_card.status<>'active' or v_card.expires_at<=now() or v_card.current_balance<=0 then
    raise exception 'Gift Card no disponible';
  end if;
  if not v_card.transferable and lower(btrim(coalesce(p_recipient_name,'')))<>lower(btrim(v_card.recipient_name)) then
    raise exception 'Verifica identidad del beneficiario';
  end if;
  select coalesce(sum(gift_amount),0) into v_reserved from public.gift_card_order_payments
    where gift_card_id=p_card_id and status='reserved';
  v_debit:=least(v_card.current_balance-v_reserved,p_consumption_amount);
  if v_debit<=0 then raise exception 'Saldo reservado para otro pedido'; end if;
  update public.gift_cards set current_balance=current_balance-v_debit,
    status=case when current_balance-v_debit=0 then 'exhausted' else 'active' end where id=p_card_id;
  insert into public.gift_card_transactions
    (gift_card_id,movement_type,amount,balance_before,balance_after,reference,performed_by,consumption_channel)
  values(p_card_id,'redemption',-v_debit,v_card.current_balance,v_card.current_balance-v_debit,
    p_reference,auth.uid(),'in_store');
  return jsonb_build_object('debited',v_debit,'remaining_to_pay',p_consumption_amount-v_debit,
    'balance',v_card.current_balance-v_debit,'idempotent',false);
end $$;

create or replace function public.block_gift_card(p_card_id uuid)
returns public.gift_cards language plpgsql security definer set search_path = '' as $$
declare v_card public.gift_cards; v_reserved numeric(12,2);
begin
  -- NULL roles MUST be rejected. Do not replace with bare NULL NOT IN (...).
  if coalesce(private.gift_card_staff_role(),'') not in ('manager','admin') then
    raise exception 'No autorizado';
  end if;
  select * into v_card from public.gift_cards where id=p_card_id for update;
  if not found or v_card.status<>'active' or v_card.expires_at<=now() then
    raise exception 'Solo se puede bloquear una Gift Card activa';
  end if;
  select coalesce(sum(gift_amount),0) into v_reserved from public.gift_card_order_payments
    where gift_card_id=p_card_id and status='reserved';
  if v_reserved>0 then raise exception 'Esta Gift Card tiene un pago en curso'; end if;
  update public.gift_cards set status='blocked',blocked_at=now(),blocked_by=auth.uid()
    where id=p_card_id returning * into v_card;
  insert into public.gift_card_transactions
    (gift_card_id,movement_type,amount,balance_before,balance_after,performed_by)
  values(p_card_id,'block',0,v_card.current_balance,v_card.current_balance,auth.uid());
  return v_card;
end $$;

revoke all on function public.redeem_gift_card(uuid,numeric,text,text),
  public.block_gift_card(uuid) from public, anon;
grant execute on function public.redeem_gift_card(uuid,numeric,text,text),
  public.block_gift_card(uuid) to authenticated;
