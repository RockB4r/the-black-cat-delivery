-- STAGING ONLY. Synthetic data, no provider requests. Roll back all rows/flag changes.
begin;
do $$
declare
  v_admin uuid:=gen_random_uuid(); v_manager uuid:=gen_random_uuid(); v_staff uuid:=gen_random_uuid();
  v_inactive uuid:=gen_random_uuid(); v_none uuid:=gen_random_uuid(); v_uid uuid;
  v_checkout uuid:=gen_random_uuid(); v_full_checkout uuid:=gen_random_uuid(); v_mixed_checkout uuid:=gen_random_uuid();
  v_order uuid; v_mixed uuid; v_attempt uuid; v_manual public.gift_cards; v_card public.gift_cards;
  v_result jsonb; v_audit bigint; v_before numeric;
begin
  assert not has_function_privilege('anon','public.set_gift_card_operation(text,boolean)','EXECUTE'), 'anon setter exposed';
  assert not has_table_privilege('anon','public.app_settings','UPDATE'), 'anon settings write exposed';
  assert not has_table_privilege('authenticated','public.gift_card_operation_audit','INSERT'), 'audit editable';
  assert not has_sequence_privilege('anon','public.gift_card_operation_audit_id_seq','USAGE'), 'audit sequence exposed';
  insert into auth.users(id,email) values
    (v_admin,'gc-ops-admin-'||v_admin::text||'@example.invalid'),(v_manager,'gc-ops-manager-'||v_manager::text||'@example.invalid'),
    (v_staff,'gc-ops-staff-'||v_staff::text||'@example.invalid'),(v_inactive,'gc-ops-inactive-'||v_inactive::text||'@example.invalid'),
    (v_none,'gc-ops-none-'||v_none::text||'@example.invalid');
  insert into public.staff_profiles(user_id,display_name,role,active) values
    (v_admin,'Synthetic admin','admin',true),(v_manager,'Synthetic manager','manager',true),
    (v_staff,'Synthetic staff','staff',true),(v_inactive,'Synthetic inactive','admin',false);
  update public.app_settings set value='{"gift_card_sales_enabled":false,"gift_card_redemption_enabled":false}' where key='gift_card_operations';
  begin
    insert into public.gift_card_purchases(checkout_id,amount,purchaser_name,purchaser_email,transferable,delivery_method)
      values(v_checkout,50,'Synthetic','synthetic@example.invalid',true,'personal');
    raise exception 'disabled sales admitted';
  exception when others then if sqlerrm<>'New Gift Card operations are suspended' then raise; end if; end;
  select count(*) into v_audit from public.gift_card_operation_audit;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform public.set_gift_card_operation('gift_card_sales_enabled',true);
  assert (select value->'gift_card_sales_enabled' from public.app_settings where key='gift_card_operations')='true'::jsonb,'admin cannot enable';
  perform set_config('request.jwt.claim.sub',v_manager::text,true);
  perform public.set_gift_card_operation('gift_card_redemption_enabled',true);
  assert (select value->'gift_card_redemption_enabled' from public.app_settings where key='gift_card_operations')='true'::jsonb,'manager cannot enable';
  for v_uid in select unnest(array[v_staff,v_inactive,v_none]) loop
    perform set_config('request.jwt.claim.sub',v_uid::text,true);
    begin
      perform public.set_gift_card_operation('gift_card_sales_enabled',false);
      raise exception 'unauthorized setter admitted';
    exception when others then if sqlerrm<>'No autorizado' then raise; end if; end;
    assert not exists(select 1 from public.app_settings where key='gift_card_operations'),'unauthorized settings visible';
  end loop;
  execute 'reset role';
  assert exists(select 1 from public.gift_card_operation_audit where actor=v_admin and actor_role='authenticated'
    and old_value->'gift_card_sales_enabled'='false'::jsonb and new_value->'gift_card_sales_enabled'='true'::jsonb
    and occurred_at is not null), 'admin audit missing';
  assert exists(select 1 from public.gift_card_operation_audit where actor=v_manager),'manager audit missing';
  assert (select count(*) from public.gift_card_operation_audit)=v_audit+2,'unauthorized/no-op changes polluted audit';
  perform set_config('request.jwt.claim.sub','',true);
  execute 'set local role service_role';
  perform public.set_gift_card_operation('gift_card_sales_enabled',true);
  execute 'reset role';
  insert into public.gift_card_purchases(checkout_id,amount,purchaser_name,purchaser_email,transferable,delivery_method,culqi_order_id)
    values(v_checkout,50,'Synthetic','synthetic@example.invalid',true,'personal','ord_test_ops_'||v_checkout::text);
  update public.app_settings set value=jsonb_set(value,'{gift_card_sales_enabled}','false') where key='gift_card_operations';
  -- Existing paid-purchase finalization and retry are never gated by sales suspension.
  v_result:=public.finalize_gift_card_purchase(v_checkout,'ord_test_ops_'||v_checkout::text,null);
  perform public.finalize_gift_card_purchase(v_checkout,'ord_test_ops_'||v_checkout::text,null);
  select * into v_card from public.gift_cards where qr_token=v_result->>'token';
  assert v_card.current_balance=50 and v_card.status='active','existing purchase finalization blocked';
  assert (select count(*) from public.gift_cards where id=v_card.id)=1,'purchase duplicated';
  insert into public.orders(order_number,checkout_id,customer_name,customer_phone,order_type,payment_method,payment_status,subtotal,total,receipt_type)
    values('OPS-FULL-'||v_full_checkout::text,v_full_checkout,'Synthetic','000000000','pick_up','wallet','pending',20,20,'boleta') returning id into v_order;
  update public.app_settings set value=jsonb_set(value,'{gift_card_redemption_enabled}','false') where key='gift_card_operations';
  begin
    perform public.reserve_gift_card_for_order(v_order,v_full_checkout,v_card.online_payment_code,'Synthetic');
    raise exception 'disabled total payment admitted';
  exception when others then if sqlerrm<>'New Gift Card operations are suspended' then raise; end if; end;
  assert not exists(select 1 from public.gift_card_order_payments where order_id=v_order),'failed admission left reservation';
  assert (select current_balance from public.gift_cards where id=v_card.id)=50,'failed admission changed balance';
  update public.app_settings set value=jsonb_set(value,'{gift_card_redemption_enabled}','true') where key='gift_card_operations';
  perform public.reserve_gift_card_for_order(v_order,v_full_checkout,v_card.online_payment_code,'Synthetic');
  update public.app_settings set value=jsonb_set(value,'{gift_card_redemption_enabled}','false') where key='gift_card_operations';
  perform public.apply_gift_card_to_order(v_order,null);
  perform public.apply_gift_card_to_order(v_order,null);
  assert (select current_balance from public.gift_cards where id=v_card.id)=30,'admitted total payment blocked';
  assert (select count(*) from public.gift_card_transactions where order_id=v_order and movement_type='redemption')=1,'total completion duplicated';
  insert into public.orders(order_number,checkout_id,customer_name,customer_phone,order_type,payment_method,payment_status,subtotal,total,receipt_type,culqi_order_id)
    values('OPS-MIXED-'||v_mixed_checkout::text,v_mixed_checkout,'Synthetic','000000000','pick_up','wallet','pending',80,80,'factura','ord_test_ops_'||v_mixed_checkout::text) returning id into v_mixed;
  begin
    perform public.reserve_gift_card_for_order(v_mixed,v_mixed_checkout,v_card.online_payment_code,'Synthetic');
    raise exception 'disabled mixed payment admitted';
  exception when others then if sqlerrm<>'New Gift Card operations are suspended' then raise; end if; end;
  update public.app_settings set value=jsonb_set(value,'{gift_card_redemption_enabled}','true') where key='gift_card_operations';
  perform public.reserve_gift_card_for_order(v_mixed,v_mixed_checkout,v_card.online_payment_code,'Synthetic');
  update public.app_settings set value=jsonb_set(value,'{gift_card_redemption_enabled}','false') where key='gift_card_operations';
  begin
    perform public.begin_mixed_culqi_attempt(v_mixed,v_mixed_checkout,'ord_test_ops_'||v_mixed_checkout::text);
    raise exception 'disabled new mixed charge admitted';
  exception when others then if sqlerrm<>'New Gift Card operations are suspended' then raise; end if; end;
  assert not exists(select 1 from public.gift_card_culqi_attempts where order_id=v_mixed),'failed charge admission left attempt';
  update public.app_settings set value=jsonb_set(value,'{gift_card_redemption_enabled}','true') where key='gift_card_operations';
  v_result:=public.begin_mixed_culqi_attempt(v_mixed,v_mixed_checkout,'ord_test_ops_'||v_mixed_checkout::text);
  v_attempt:=(v_result->>'id')::uuid;
  update public.app_settings set value=jsonb_set(value,'{gift_card_redemption_enabled}','false') where key='gift_card_operations';
  perform public.mark_mixed_culqi_attempt(v_attempt,'reconciliation_required','synthetic_test_timeout');
  assert (select status from public.gift_card_order_payments where order_id=v_mixed)='reserved','suspension released uncertain balance';
  perform public.complete_mixed_culqi_attempt(v_mixed,v_attempt,'ord_test_ops_'||v_mixed_checkout::text,null,'synthetic_webhook');
  v_result:=public.complete_mixed_culqi_attempt(v_mixed,v_attempt,'ord_test_ops_'||v_mixed_checkout::text,null,'synthetic_webhook_duplicate');
  assert v_result->>'idempotent'='true','existing completion no longer idempotent';
  assert (select count(*) from public.gift_card_transactions where order_id=v_mixed and movement_type='redemption')=1,'webhook duplicated redemption';
  assert (select current_balance from public.gift_cards where id=v_card.id)=0,'existing mixed completion blocked';
  assert (select total from public.orders where id=v_mixed)=80,'consumption total changed';
  -- Manual new redemptions are also stopped, atomically including balance update.
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  execute 'set local role authenticated';
  v_manual:=public.create_gift_card(50,'Synthetic manual');
  begin
    perform public.redeem_gift_card(v_manual.id,10,'OPS-MANUAL-'||v_checkout::text,null);
    raise exception 'disabled manual redemption admitted';
  exception when others then if sqlerrm<>'New Gift Card operations are suspended' then raise; end if; end;
  assert (select current_balance from public.gift_cards where id=v_manual.id)=50,'manual rejection consumed balance';
  execute 'reset role';
  begin
    update public.app_settings set value='{"gift_card_sales_enabled":"true"}' where key='gift_card_operations';
    raise exception 'invalid settings stored';
  exception when check_violation then null; end;
  delete from public.app_settings where key='gift_card_operations';
  begin
    insert into public.gift_card_purchases(checkout_id,amount,purchaser_name,purchaser_email,transferable,delivery_method)
      values(gen_random_uuid(),50,'Synthetic','synthetic@example.invalid',true,'personal');
    raise exception 'missing flag admitted purchase';
  exception when others then if sqlerrm<>'New Gift Card operations are suspended' then raise; end if; end;
end $$;
select 'PASS: suspension, roles, audit, total/mixed/manual admission, existing completion, idempotency, fail-safe' as result;
rollback;
