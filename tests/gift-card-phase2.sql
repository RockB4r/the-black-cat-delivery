-- Run only after gift_cards_phase2 migration. Everything is rolled back.
begin;

do $$
declare
  v_checkout uuid := gen_random_uuid();
  v_charge_checkout uuid := gen_random_uuid();
  v_charge_id text := 'chr_test_' || left(replace(v_charge_checkout::text,'-',''),16);
  v_card public.gift_cards;
  v_order_id uuid;
  v_order_checkout uuid := gen_random_uuid();
  v_full_id uuid;
  v_full_checkout uuid := gen_random_uuid();
  v_block_checkout uuid := gen_random_uuid();
  v_block_id uuid;
  v_expiry_checkout uuid := gen_random_uuid();
  v_expiry_order uuid;
  v_pending_checkout uuid := gen_random_uuid();
  v_pending_order uuid;
  v_result jsonb;
  v_before numeric;
  v_released boolean;
begin
  if has_table_privilege('anon', 'public.gift_card_purchases', 'SELECT')
    or has_table_privilege('authenticated', 'public.gift_card_purchases', 'SELECT')
    or has_function_privilege('anon', 'public.finalize_gift_card_purchase(uuid,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.reserve_gift_card_for_order(uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'Public Gift Card permissions are too broad';
  end if;

  insert into public.gift_card_purchases(checkout_id,amount,purchaser_name,purchaser_email,transferable,delivery_method,culqi_order_id)
    values (v_checkout,50,'Compra prueba','test@example.invalid',true,'personal','ord_test_phase2_' || v_checkout::text);
  if exists(select 1 from public.gift_cards where culqi_order_id='ord_test_phase2_' || v_checkout::text) then
    raise exception 'Gift Card activated before payment confirmation';
  end if;
  v_result := public.finalize_gift_card_purchase(v_checkout,'ord_test_phase2_' || v_checkout::text,null);
  select * into v_card from public.gift_cards where qr_token=v_result ->> 'token';
  if v_card.status <> 'active' or v_card.current_balance <> 50 or v_card.purchase_channel <> 'online'
    or v_card.expires_at < v_card.activated_at + interval '44 days 23 hours' then
    raise exception 'Purchase activation is invalid';
  end if;
  perform public.finalize_gift_card_purchase(v_checkout,'ord_test_phase2_' || v_checkout::text,null);
  if (select count(*) from public.gift_cards where culqi_order_id='ord_test_phase2_' || v_checkout::text) <> 1 then
    raise exception 'Purchase idempotency failed';
  end if;

  insert into public.gift_card_purchases(checkout_id,amount,purchaser_name,purchaser_email,transferable,delivery_method,culqi_charge_id)
    values (v_charge_checkout,50,'Compra prueba','test@example.invalid',true,'personal',v_charge_id);
  perform public.finalize_gift_card_purchase(v_charge_checkout,null,v_charge_id);
  perform public.finalize_gift_card_purchase(v_charge_checkout,null,v_charge_id);
  if (select count(*) from public.gift_cards where culqi_charge_id=v_charge_id) <> 1
    or (select count(*) from public.gift_card_transactions where source_reference='gift_purchase:' || v_charge_checkout::text) <> 1 then
    raise exception 'Same checkout and charge were not idempotent';
  end if;
  begin
    insert into public.gift_card_purchases(checkout_id,amount,purchaser_name,purchaser_email,transferable,delivery_method,culqi_charge_id)
      values (gen_random_uuid(),50,'Compra prueba','test@example.invalid',true,'personal',v_charge_id);
    raise exception 'A reused charge was accepted';
  exception when unique_violation then null;
  end;

  insert into public.orders(order_number,checkout_id,customer_name,customer_phone,order_type,payment_method,payment_status,subtotal,total,receipt_type)
    values ('TBC-TEST-' || left(v_order_checkout::text,8),v_order_checkout,'Cliente prueba','999999999','pick_up','wallet','pending',80,80,'boleta') returning id into v_order_id;
  v_result := public.reserve_gift_card_for_order(v_order_id,v_order_checkout,v_card.online_payment_code,'Cliente prueba');
  if (v_result ->> 'gift_amount')::numeric <> 50 or (v_result ->> 'other_amount')::numeric <> 30 then
    raise exception 'Mixed payment calculation failed';
  end if;
  begin
    perform public.apply_gift_card_to_order(v_order_id,null);
    raise exception 'Mixed Gift Card was redeemed without Culqi confirmation';
  exception when others then
    if sqlerrm <> 'Referencia Culqi no coincide con el pedido' then raise; end if;
  end;
  update public.orders set culqi_order_id='ord_test_mixed_' || v_order_checkout::text where id=v_order_id;
  perform public.apply_gift_card_to_order(v_order_id,'ord_test_mixed_' || v_order_checkout::text);
  perform public.apply_gift_card_to_order(v_order_id,'ord_test_mixed_' || v_order_checkout::text);
  select current_balance into v_before from public.gift_cards where id=v_card.id;
  if v_before <> 0 or (select status from public.gift_cards where id=v_card.id) <> 'exhausted'
    or (select count(*) from public.gift_card_transactions where order_id=v_order_id and movement_type='redemption') <> 1
    or (select consumption_channel from public.gift_card_transactions where order_id=v_order_id and movement_type='redemption') <> 'online'
    or (select receipt_type from public.orders where id=v_order_id) <> 'boleta' then
    raise exception 'Mixed redemption, idempotency or receipt linkage failed';
  end if;
  v_result := public.reject_gift_card_order(v_order_id,'Producto no disponible','Prueba','Manager',null);
  if (v_result->>'gift_restored')::boolean is distinct from true
    or (v_result->>'culqi_refund_required')::boolean is distinct from true
    or (select current_balance from public.gift_cards where id=v_card.id) <> 50
    or (select gift_card_refund_status from public.orders where id=v_order_id) <> 'completed'
    or (select external_payment_refund_status from public.orders where id=v_order_id) <> 'pending'
    or (select payment_status from public.orders where id=v_order_id) <> 'refund_pending'
    or (select count(*) from public.gift_card_transactions where order_id=v_order_id and movement_type='refund') <> 1 then
    raise exception 'Mixed order rejection/refund split failed';
  end if;
  begin
    update public.gift_cards set current_balance=-1 where id=v_card.id;
    raise exception 'Negative balance was accepted';
  exception when check_violation then null;
  end;

  insert into public.gift_cards(code,initial_balance,current_balance,status,purchaser_name,activated_at,expires_at)
    values ('BC-GC-TEST-' || left(v_full_checkout::text,8),100,100,'active','Compra prueba',now(),now()+interval '45 days') returning * into v_card;
  insert into public.orders(order_number,checkout_id,customer_name,customer_phone,order_type,payment_method,payment_status,subtotal,total,receipt_type,receipt_document_number,receipt_legal_name)
    values ('TBC-TEST-' || left(v_full_checkout::text,8),v_full_checkout,'Cliente prueba','999999999','pick_up','wallet','pending',42,42,'factura','20610407499','Heritage Group S.A.C.') returning id into v_full_id;
  perform public.reserve_gift_card_for_order(v_full_id,v_full_checkout,v_card.online_payment_code,'Cliente prueba');
  perform public.apply_gift_card_to_order(v_full_id,null);
  if (select current_balance from public.gift_cards where id=v_card.id) <> 58
    or (select payment_status from public.orders where id=v_full_id) <> 'paid'
    or (select receipt_legal_name from public.orders where id=v_full_id) <> 'Heritage Group S.A.C.' then
    raise exception 'Full Gift Card payment or invoice data failed';
  end if;

  update public.gift_cards set status='blocked' where id=v_card.id;
  insert into public.orders(order_number,checkout_id,customer_name,customer_phone,order_type,payment_method,payment_status,subtotal,total,receipt_type)
    values ('TBC-TEST-' || left(v_block_checkout::text,8),v_block_checkout,'Cliente prueba','999999999','pick_up','wallet','pending',10,10,'boleta') returning id into v_block_id;
  begin
    perform public.reserve_gift_card_for_order(v_block_id,v_block_checkout,v_card.online_payment_code,'Cliente prueba');
    raise exception 'Blocked card was accepted';
  exception when others then
    if sqlerrm <> 'Gift Card no disponible' then raise; end if;
  end;
  update public.gift_cards set status='active',expires_at=now()-interval '1 minute' where id=v_card.id;
  begin
    perform public.reserve_gift_card_for_order(v_block_id,v_block_checkout,v_card.online_payment_code,'Cliente prueba');
    raise exception 'Expired card was accepted';
  exception when others then
    if sqlerrm <> 'Gift Card no disponible' then raise; end if;
  end;
  update public.gift_cards set expires_at=now()+interval '45 days',current_balance=0,status='exhausted' where id=v_card.id;
  begin
    perform public.reserve_gift_card_for_order(v_block_id,v_block_checkout,v_card.online_payment_code,'Cliente prueba');
    raise exception 'Exhausted card was accepted';
  exception when others then
    if sqlerrm <> 'Gift Card no disponible' then raise; end if;
  end;

  insert into public.gift_cards(code,initial_balance,current_balance,status,purchaser_name,activated_at,expires_at)
    values ('BC-GC-TEST-' || left(v_expiry_checkout::text,8),100,100,'active','Compra prueba',now(),now()+interval '45 days') returning * into v_card;
  insert into public.orders(order_number,checkout_id,customer_name,customer_phone,order_type,payment_method,payment_status,subtotal,total,receipt_type)
    values ('TBC-TEST-' || left(v_expiry_checkout::text,8),v_expiry_checkout,'Cliente prueba','999999999','pick_up','wallet','pending',30,30,'boleta') returning id into v_expiry_order;
  perform public.reserve_gift_card_for_order(v_expiry_order,v_expiry_checkout,v_card.online_payment_code,'Cliente prueba');
  update public.gift_card_order_payments set reserved_at=now()-interval '2 hours',expires_at=now()-interval '1 minute' where order_id=v_expiry_order;
  v_released := public.release_gift_card_order_reservation(v_expiry_order);
  if v_released is distinct from true then
    raise exception 'No-payment expired reservation was not released';
  end if;
  if (select status from public.gift_card_order_payments where order_id=v_expiry_order) is distinct from 'released' then
    raise exception 'No-payment expired reservation status was not released';
  end if;

  insert into public.orders(order_number,checkout_id,customer_name,customer_phone,order_type,payment_method,payment_status,subtotal,total,receipt_type)
    values ('TBC-TEST-' || left(v_pending_checkout::text,8),v_pending_checkout,'Cliente prueba','999999999','pick_up','wallet','pending',120,120,'boleta') returning id into v_pending_order;
  perform public.reserve_gift_card_for_order(v_pending_order,v_pending_checkout,v_card.online_payment_code,'Cliente prueba');
  update public.orders set culqi_order_id='ord_test_pending_' || v_pending_checkout::text where id=v_pending_order;
  update public.gift_card_order_payments set reserved_at=now()-interval '2 hours',expires_at=now()-interval '1 minute',payment_state='payment_pending' where order_id=v_pending_order;
  begin
    perform public.release_gift_card_order_reservation(v_pending_order);
    raise exception 'Uncertain mixed payment was released';
  exception when others then
    if sqlerrm<>'Confirmar vencimiento Culqi antes de liberar' then raise; end if;
  end;
  update public.gift_card_order_payments set payment_state='expired' where order_id=v_pending_order;
  if public.release_gift_card_order_reservation(v_pending_order) is distinct from true then
    raise exception 'Verified expired mixed reservation was not released';
  end if;
end $$;

rollback;
