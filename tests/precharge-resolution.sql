-- Synthetic staging tests; no provider calls, no persistent fixtures.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$
declare actor_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); oid uuid; cid uuid; checkout uuid;
  evidence jsonb; result jsonb; c text; denied boolean; checks integer:=0;
begin
  insert into auth.users(id,email) values(actor_id,'precharge-admin-'||actor_id||'@example.invalid'),(staff_id,'precharge-staff-'||staff_id||'@example.invalid');
  insert into public.staff_profiles(user_id,display_name,role,active) values(actor_id,'Synthetic precharge admin','admin',true),(staff_id,'Synthetic precharge staff','staff',true);
  update public.app_settings set value='{"gift_card_sales_enabled":false,"gift_card_redemption_enabled":true}'::jsonb where key='gift_card_operations';
  assert not has_function_privilege('anon','public.resolve_precharge_gift_card_order(uuid,uuid,uuid,text,jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.resolve_precharge_gift_card_order(uuid,uuid,uuid,text,jsonb)','EXECUTE');
  assert has_function_privilege('service_role','public.resolve_precharge_gift_card_order(uuid,uuid,uuid,text,jsonb)','EXECUTE');
  assert not has_table_privilege('anon','public.gift_card_precharge_resolutions','SELECT,INSERT,UPDATE,DELETE');
  assert not has_table_privilege('authenticated','public.gift_card_precharge_resolutions','SELECT,INSERT,UPDATE,DELETE');
  assert not has_table_privilege('service_role','public.gift_card_precharge_resolutions','UPDATE,DELETE,TRUNCATE');
  assert (select not f.prosecdef from pg_proc f where f.oid='public.resolve_precharge_gift_card_order(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  foreach c in array array['positive','manager','pending_external','charge_external','approved_external','attempt','redemption','refund','released','paid','checkout','card','staff','inactive','no_profile','stale','wrong_amount','wrong_order','incomplete'] loop
    checkout:=gen_random_uuid();
    insert into public.gift_cards(code,initial_balance,current_balance,status,purchaser_name,activated_at,expires_at,online_payment_code)
      values('STG-PRECHARGE-'||checkout,40,40,'active','Synthetic precharge',now(),now()+interval '45 days',md5(checkout::text)) returning id into cid;
    insert into public.orders(order_number,checkout_id,customer_name,customer_phone,order_type,payment_method,payment_status,status,subtotal,total,gift_card_id,gift_card_amount,other_payment_amount,other_payment_method,culqi_order_id)
      values('STG-PRECHARGE-'||checkout,checkout,'Synthetic precharge','000000000','pick_up','gift_card_culqi','pending','nuevo',50,50,cid,40,10,'culqi','ord_test_'||replace(checkout::text,'-','')) returning id into oid;
    insert into public.gift_card_order_payments(checkout_id,order_id,gift_card_id,gift_amount,other_amount,payment_state) values(checkout,oid,cid,40,10,'payment_pending');
    evidence:=jsonb_build_object('order_id','ord_test_'||replace(checkout::text,'-',''),'order_number','STG-PRECHARGE-'||checkout,'state','deleted','currency','PEN','amount',1000,'associated_charges',0,'approved_charges',0,'charge_scan_complete',true,'order_http',200,'checked_at',clock_timestamp());
    if c='manager' then update public.staff_profiles set role='manager' where user_id=actor_id; end if;
    if c='pending_external' then evidence:=evidence||'{"state":"pending"}'; end if;
    if c='charge_external' then evidence:=evidence||'{"associated_charges":1}'; end if;
    if c='approved_external' then evidence:=evidence||'{"approved_charges":1}'; end if;
    if c='attempt' then insert into public.gift_card_culqi_attempts(order_id,checkout_id,culqi_order_id,gift_amount,culqi_amount,status) values(oid,checkout,evidence->>'order_id',40,10,'rejected'); end if;
    if c='redemption' then insert into public.gift_card_transactions(gift_card_id,movement_type,amount,balance_before,balance_after,reference,performed_by,consumption_channel,order_id) values(cid,'redemption',-1,40,39,'synthetic-'||checkout,actor_id,'online',oid); end if;
    if c='refund' then
      insert into public.culqi_external_refunds(order_id,checkout_id,order_number,attempt_id,culqi_order_id,charge_id,amount_cents,state,created_by,updated_by,charge_since)
        values(oid,checkout,'STG-PRECHARGE-'||checkout,(select id from public.gift_card_culqi_attempts limit 1),evidence->>'order_id','chr_test_'||replace(checkout::text,'-',''),1000,'pending',actor_id,actor_id,now());
    end if;
    if c='released' then update public.gift_card_order_payments set status='released',payment_state='released' where order_id=oid; end if;
    if c='paid' then update public.orders set payment_status='paid' where id=oid; end if;
    if c='card' then update public.orders set gift_card_id=(select gift_card_id from public.gift_card_order_payments where order_id<>oid limit 1) where id=oid; end if;
    if c='inactive' then update public.staff_profiles set active=false where user_id=actor_id; end if;
    if c='stale' then evidence:=evidence||jsonb_build_object('checked_at',now()-interval '10 minutes'); end if;
    if c='wrong_amount' then evidence:=evidence||'{"amount":999}'; end if;
    if c='wrong_order' then evidence:=evidence||'{"order_id":"ord_test_other"}'; end if;
    if c='incomplete' then evidence:=evidence-'charge_scan_complete'; end if;
    denied:=false;
    begin
      execute 'set local role service_role';
      result:=public.resolve_precharge_gift_card_order(oid,case when c='checkout' then gen_random_uuid() else checkout end,case when c='staff' then staff_id when c='no_profile' then gen_random_uuid() else actor_id end,'Synthetic precharge resolution test',evidence);
    exception when others then
      if c in ('positive','manager') then raise exception 'Positive precharge SQL failed: % / %',sqlstate,sqlerrm; end if;
      denied:=true;
    end;
    reset role;
    if c in ('positive','manager') then
      assert not denied and result->>'resolved'='true' and result->>'idempotent'='false', c;
      assert (select status='released' and payment_state='released' from public.gift_card_order_payments where order_id=oid);
      assert (select payment_status='expired' from public.orders where id=oid);
      assert (select current_balance=40 and status='active' from public.gift_cards where id=cid);
      assert (select count(*)=1 from public.gift_card_precharge_resolutions where order_id=oid and actor=actor_id and prior_state->>'payment_state'='payment_pending');
      result:=public.resolve_precharge_gift_card_order(oid,checkout,actor_id,'Synthetic duplicate resolution test',evidence);
      assert result->>'idempotent'='true';
      assert (select count(*)=1 from public.gift_card_precharge_resolutions where order_id=oid);
      assert not exists(select 1 from public.gift_card_transactions where order_id=oid);
      assert not exists(select 1 from public.gift_card_culqi_attempts where order_id=oid);
    else
      assert denied, c||' unexpectedly accepted';
      assert not exists(select 1 from public.gift_card_precharge_resolutions where order_id=oid), c;
      assert (select current_balance=40 from public.gift_cards where id=cid), c;
    end if;
    update public.staff_profiles set role='admin',active=true where user_id=actor_id;
    checks:=checks+1;
  end loop;
  raise notice 'Precharge SQL PASS: % scenarios plus ACL/idempotency checks',checks;
end $$;
rollback;
