-- Run only on isolated staging. Every synthetic row is rolled back.
begin;
do $$
declare
  v_card uuid;
  v_order uuid;
  v_checkout uuid := gen_random_uuid();
  v_first uuid;
  v_second uuid;
  v_third uuid;
  v_actor uuid;
  v_result jsonb;
  v_rejected boolean := false;
  v_blocked boolean := false;
begin
  insert into public.gift_cards(code,initial_balance,current_balance,status,purchaser_name,activated_at,expires_at,online_payment_code)
  values('BC-STG-TEST-'||left(gen_random_uuid()::text,8),20,20,'active','Synthetic Test',now(),now()+interval '45 days',encode(gen_random_bytes(16),'hex'))
  returning id into v_card;
  insert into public.orders(order_number,customer_name,customer_phone,order_type,payment_method,payment_status,subtotal,total,
    gift_card_id,gift_card_amount,other_payment_amount,other_payment_method,checkout_id,culqi_order_id)
  values('TBC-STG-'||left(gen_random_uuid()::text,8),'Synthetic Test','000000000','pick_up','gift_card_culqi','pending',40,40,
    v_card,20,20,'culqi',v_checkout,'ord_test_synthetic_'||left(gen_random_uuid()::text,8))
  returning id into v_order;
  insert into public.gift_card_order_payments(checkout_id,order_id,gift_card_id,gift_amount,other_amount)
  values(v_checkout,v_order,v_card,20,20);
  select public.begin_mixed_culqi_attempt(v_order,v_checkout,culqi_order_id) into v_result from public.orders where id=v_order;
  v_first := (v_result->>'id')::uuid;
  assert (select count(*) from public.gift_card_culqi_attempts where order_id=v_order and status='processing')=1,
    'attempt was not persisted before charge';
  assert (select coalesce(sum(gift_amount),0) from public.gift_card_order_payments where gift_card_id=v_card and status='reserved')=20,
    'reserved balance was not held during processing';
  begin
    perform public.begin_mixed_culqi_attempt(v_order,v_checkout,(select culqi_order_id from public.orders where id=v_order));
    raise exception 'duplicate attempt was accepted';
  exception when others then
    if sqlerrm='duplicate attempt was accepted' then raise; end if;
  end;
  begin
    perform public.release_gift_card_order_reservation(v_order);
  exception when others then v_blocked:=true;
  end;
  assert v_blocked, 'processing attempt allowed release';
  perform public.mark_mixed_culqi_attempt(v_first,'rejected','test_http_4xx');
  assert (select payment_state from public.gift_card_order_payments where order_id=v_order)='failed',
    'explicit rejection not recorded';
  select public.begin_mixed_culqi_attempt(v_order,v_checkout,culqi_order_id) into v_result from public.orders where id=v_order;
  v_second := (v_result->>'id')::uuid;
  assert v_second<>v_first, 'second attempt was not audited separately';
  perform public.mark_mixed_culqi_attempt(v_second,'reconciliation_required','test_timeout');
  assert (select payment_state from public.gift_card_order_payments where order_id=v_order)='reconciliation_required',
    'uncertain state was not persisted';
  update public.gift_card_order_payments set reserved_at=now()-interval '180 minutes',expires_at=now()-interval '90 minutes' where order_id=v_order;
  assert (select coalesce(sum(gift_amount),0) from public.gift_card_order_payments where gift_card_id=v_card and status='reserved')=20,
    '90-minute timeout consumed an uncertain reservation';
  v_blocked:=false;
  begin
    perform public.release_gift_card_order_reservation(v_order);
  exception when others then v_blocked:=true;
  end;
  assert v_blocked, 'uncertain attempt allowed release';
  begin
    perform public.mark_mixed_culqi_attempt(v_second,'rejected','late_rejection');
  exception when others then v_rejected:=true;
  end;
  assert v_rejected, 'uncertain attempt was downgraded to rejected';
  v_result:=public.complete_mixed_culqi_attempt(v_order,v_second,'chr_test_synthetic_1','chr_test_synthetic_1','test_approved');
  assert v_result->>'idempotent'='false', 'first confirmation was not applied';
  assert (select current_balance from public.gift_cards where id=v_card)=0, 'balance was not consumed exactly';
  assert (select status from public.gift_cards where id=v_card)='exhausted', 'card was not exhausted';
  assert (select current_balance from public.gift_cards where id=v_card)>=0, 'balance became negative';
  assert (select coalesce(sum(gift_amount),0) from public.gift_card_order_payments where gift_card_id=v_card and status='reserved')=0,
    'reserved balance remained after confirmation';
  assert (select count(*) from public.gift_card_transactions where order_id=v_order and movement_type='redemption')=1,
    'redemption count is not one';
  v_result:=public.complete_mixed_culqi_attempt(v_order,v_second,'chr_test_synthetic_1','chr_test_synthetic_1','test_duplicate');
  assert v_result->>'idempotent'='true', 'duplicate confirmation was not idempotent';
  assert (select count(*) from public.gift_card_transactions where order_id=v_order and movement_type='redemption')=1,
    'duplicate confirmation created another redemption';
  v_result:=public.complete_mixed_culqi_attempt(v_order,v_second,(select culqi_order_id from public.orders where id=v_order),null,'test_duplicate_webhook');
  assert v_result->>'idempotent'='true', 'later order webhook was not idempotent';
  assert public.release_gift_card_order_reservation(v_order)=false, 'applied reservation was released';

  -- Simulate a paid-order webhook winning before the HTTP charge response.
  insert into public.gift_cards(code,initial_balance,current_balance,status,purchaser_name,activated_at,expires_at,online_payment_code)
  values('BC-STG-TEST-'||left(gen_random_uuid()::text,8),20,20,'active','Synthetic Test',now(),now()+interval '45 days',encode(gen_random_bytes(16),'hex'))
  returning id into v_card;
  v_checkout:=gen_random_uuid();
  insert into public.orders(order_number,customer_name,customer_phone,order_type,payment_method,payment_status,subtotal,total,
    gift_card_id,gift_card_amount,other_payment_amount,other_payment_method,checkout_id,culqi_order_id)
  values('TBC-STG-'||left(gen_random_uuid()::text,8),'Synthetic Test','000000000','pick_up','gift_card_culqi','pending',40,40,
    v_card,20,20,'culqi',v_checkout,'ord_test_synthetic_'||left(gen_random_uuid()::text,8))
  returning id into v_order;
  insert into public.gift_card_order_payments(checkout_id,order_id,gift_card_id,gift_amount,other_amount)
  values(v_checkout,v_order,v_card,20,20);
  select public.begin_mixed_culqi_attempt(v_order,v_checkout,culqi_order_id) into v_result from public.orders where id=v_order;
  v_third:=(v_result->>'id')::uuid;
  v_result:=public.complete_mixed_culqi_attempt(v_order,v_third,(select culqi_order_id from public.orders where id=v_order),null,'test_webhook_first');
  assert v_result->>'idempotent'='false', 'webhook-first confirmation did not apply';
  v_result:=public.complete_mixed_culqi_attempt(v_order,v_third,'chr_test_synthetic_2','chr_test_synthetic_2','test_charge_later');
  assert v_result->>'idempotent'='true', 'later charge response was not idempotent';
  assert (select culqi_charge_id from public.orders where id=v_order)='chr_test_synthetic_2', 'later charge was not linked';
  assert (select count(*) from public.gift_card_transactions where order_id=v_order and movement_type='redemption')=1,
    'webhook-first race created duplicate redemption';

  -- Manual no-charge resolution is audited and never redeems the balance.
  select user_id into v_actor from public.staff_profiles where role='admin' and active=true limit 1;
  assert v_actor is not null, 'synthetic staging admin is required for audit test';
  insert into public.gift_cards(code,initial_balance,current_balance,status,purchaser_name,activated_at,expires_at,online_payment_code)
  values('BC-STG-TEST-'||left(gen_random_uuid()::text,8),20,20,'active','Synthetic Test',now(),now()+interval '45 days',encode(gen_random_bytes(16),'hex'))
  returning id into v_card;
  v_checkout:=gen_random_uuid();
  insert into public.orders(order_number,customer_name,customer_phone,order_type,payment_method,payment_status,subtotal,total,
    gift_card_id,gift_card_amount,other_payment_amount,other_payment_method,checkout_id,culqi_order_id)
  values('TBC-STG-'||left(gen_random_uuid()::text,8),'Synthetic Test','000000000','pick_up','gift_card_culqi','pending',40,40,
    v_card,20,20,'culqi',v_checkout,'ord_test_synthetic_'||left(gen_random_uuid()::text,8))
  returning id into v_order;
  insert into public.gift_card_order_payments(checkout_id,order_id,gift_card_id,gift_amount,other_amount)
  values(v_checkout,v_order,v_card,20,20);
  select public.begin_mixed_culqi_attempt(v_order,v_checkout,culqi_order_id) into v_result from public.orders where id=v_order;
  v_third:=(v_result->>'id')::uuid;
  perform public.mark_mixed_culqi_attempt(v_third,'reconciliation_required','test_timeout');
  assert public.clear_mixed_culqi_attempt(v_order,v_third,v_actor,'Verified no Culqi charge in staging')=true,
    'manual no-charge resolution did not release';
  assert public.clear_mixed_culqi_attempt(v_order,v_third,v_actor,'Verified no Culqi charge in staging')=true,
    'duplicate manual no-charge resolution was not idempotent';
  assert (select current_balance from public.gift_cards where id=v_card)=20, 'manual no-charge resolution consumed balance';
  assert (select coalesce(sum(gift_amount),0) from public.gift_card_order_payments where gift_card_id=v_card and status='reserved')=0,
    'reserved balance remained after manual release';
  assert (select count(*) from public.gift_card_transactions where order_id=v_order)=0, 'manual no-charge created movement';
end $$;
rollback;
select 'gift-card-mixed-attempt-sql-passed' as result;
