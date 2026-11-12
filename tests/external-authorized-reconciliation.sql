-- Synthetic fixtures only. Run as postgres; all fixtures, role changes and test trigger ROLLBACK.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
create function pg_temp.fail_authorized_audit() returns trigger language plpgsql as $$
begin
  if current_setting('blackcat.test_fail_authorized_audit',true)='on' then raise exception 'Synthetic mid-transaction failure'; end if;
  return new;
end $$;
create trigger test_fail_authorized_audit before insert on public.gift_card_authorized_resolutions
  for each row execute function pg_temp.fail_authorized_audit();
do $test$
declare actor_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); oid uuid; card uuid; checkout uuid; aid uuid;
  charge text; c text; e jsonb; result jsonb; denied boolean; checks integer:=0; balance_before numeric;
begin
  insert into auth.users(id,email) values(actor_id,'authorized-admin-'||actor_id||'@example.invalid'),(staff_id,'authorized-staff-'||staff_id||'@example.invalid');
  insert into public.staff_profiles(user_id,display_name,role,active) values(actor_id,'Synthetic authorized admin','admin',true),(staff_id,'Synthetic authorized staff','staff',true);
  update public.app_settings set value='{"gift_card_sales_enabled":false,"gift_card_redemption_enabled":true}' where key='gift_card_operations';
  assert not has_function_privilege('anon','public.reconcile_externally_authorized_mixed_attempt(uuid,uuid,text,uuid,jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.reconcile_externally_authorized_mixed_attempt(uuid,uuid,text,uuid,jsonb)','EXECUTE');
  assert has_function_privilege('service_role','public.reconcile_externally_authorized_mixed_attempt(uuid,uuid,text,uuid,jsonb)','EXECUTE');
  assert not has_table_privilege('anon','public.gift_card_authorized_resolutions','SELECT,INSERT,UPDATE,DELETE');
  assert not has_table_privilege('authenticated','public.gift_card_authorized_resolutions','SELECT,INSERT,UPDATE,DELETE');
  assert not has_table_privilege('service_role','public.gift_card_authorized_resolutions','UPDATE,DELETE,TRUNCATE');
  assert (select not f.prosecdef from pg_proc f where f.oid='public.reconcile_externally_authorized_mixed_attempt(uuid,uuid,text,uuid,jsonb)'::regprocedure);
  foreach c in array array['positive','manager','other_rejected','processing','phase','amount','currency','checkout','attempt',
    'multiple_charges','zero_approved','external_refund','local_refund','redemption','released','balance','blocked','paid',
    'staff','inactive','no_profile','stale','capture','incomplete','fault','partial_replay','different_charge_replay'] loop
    checkout:=gen_random_uuid();charge:='chr_test_'||replace(checkout::text,'-','');
    insert into public.gift_cards(code,initial_balance,current_balance,status,purchaser_name,activated_at,expires_at,online_payment_code)
      values('STG-AUTH-'||checkout,40,40,'active','Synthetic authorization recovery',now(),now()+interval '45 days',md5(checkout::text)) returning id into card;
    insert into public.orders(order_number,checkout_id,customer_name,customer_phone,order_type,payment_method,payment_status,status,subtotal,total,gift_card_id,gift_card_amount,other_payment_amount,other_payment_method,culqi_order_id)
      values('STG-AUTH-'||checkout,checkout,'Synthetic authorization recovery','000000000','pick_up','gift_card_culqi','pending','nuevo',50,50,card,40,10,'culqi','ord_test_'||replace(checkout::text,'-','')) returning id into oid;
    insert into public.gift_card_order_payments(checkout_id,order_id,gift_card_id,gift_amount,other_amount,payment_state) values(checkout,oid,card,40,10,'failed');
    insert into public.gift_card_culqi_attempts(order_id,checkout_id,culqi_order_id,gift_amount,culqi_amount,status,resolution_source,three_ds_phase,
      three_ds_context_hash,three_ds_continuation_hash,three_ds_expires_at,three_ds_updated_at)
      values(oid,checkout,'ord_test_'||replace(checkout::text,'-',''),40,10,'rejected','culqi_body_rejected','authenticated_request_sent',
      repeat('a',64),repeat('b',64),now()+interval '10 minutes',now()) returning id into aid;
    e:=jsonb_build_object('charge_id',charge,'order_id','ord_test_'||replace(checkout::text,'-',''),'order_number','STG-AUTH-'||checkout,
      'checkout_id',checkout,'attempt_id',aid,'amount',1000,'currency','PEN','capture',true,'outcome_type','venta_exitosa','outcome_code','AUT0000',
      'authorization_present',true,'decline_absent',true,'classification','approved','associated_charges',1,'approved_charges',1,'refunds',0,
      'charge_scan_complete',true,'refund_scan_complete',true,'charge_http',200,'checked_at',clock_timestamp());
    if c='manager' then update public.staff_profiles set role='manager' where user_id=actor_id; end if;
    if c='other_rejected' then update public.gift_card_culqi_attempts set resolution_source='culqi_http_4xx' where id=aid; end if;
    if c='processing' then update public.gift_card_culqi_attempts set status='processing' where id=aid; end if;
    if c='phase' then update public.gift_card_culqi_attempts set three_ds_phase='awaiting_3ds' where id=aid; end if;
    if c='amount' then e:=e||'{"amount":999}'; end if;
    if c='currency' then e:=e||'{"currency":"USD"}'; end if;
    if c='multiple_charges' then e:=e||'{"associated_charges":2}'; end if;
    if c='zero_approved' then e:=e||'{"approved_charges":0}'; end if;
    if c='external_refund' then e:=e||'{"refunds":1}'; end if;
    if c='local_refund' then insert into public.culqi_external_refunds(order_id,checkout_id,order_number,attempt_id,culqi_order_id,charge_id,amount_cents,state,created_by,updated_by,charge_since)
      values(oid,checkout,'STG-AUTH-'||checkout,aid,e->>'order_id',charge,1000,'pending',actor_id,actor_id,now()); end if;
    if c='redemption' then insert into public.gift_card_transactions(gift_card_id,movement_type,amount,balance_before,balance_after,reference,performed_by,consumption_channel,order_id,source_reference)
      values(card,'redemption',-1,40,39,'STG-AUTH-'||checkout,actor_id,'online',oid,'online_order:'||oid::text); end if;
    if c='released' then update public.gift_card_order_payments set status='released',payment_state='released' where order_id=oid; end if;
    if c='balance' then update public.gift_cards set current_balance=39 where id=card; end if;
    if c='blocked' then update public.gift_cards set status='blocked' where id=card; end if;
    if c='paid' then update public.orders set payment_status='paid' where id=oid; end if;
    if c='inactive' then update public.staff_profiles set active=false where user_id=actor_id; end if;
    if c='stale' then e:=e||jsonb_build_object('checked_at',now()-interval '10 minutes'); end if;
    if c='capture' then e:=e||'{"capture":false}'; end if;
    if c='incomplete' then e:=e-'refund_scan_complete'; end if;
    select current_balance into balance_before from public.gift_cards where id=card;
    perform set_config('blackcat.test_fail_authorized_audit',case when c='fault' then 'on' else 'off' end,true);
    denied:=false;
    begin
      execute 'set local role service_role';
      result:=public.reconcile_externally_authorized_mixed_attempt(case when c='attempt' then gen_random_uuid() else aid end,
        case when c='checkout' then gen_random_uuid() else checkout end,charge,
        case when c='staff' then staff_id when c='no_profile' then gen_random_uuid() else actor_id end,e);
    exception when others then
      if c in ('positive','manager','partial_replay','different_charge_replay') then raise exception 'Positive authorized SQL failed: % / %',sqlstate,sqlerrm; end if;
      denied:=true;
    end;
    reset role;
    if c in ('positive','manager','partial_replay','different_charge_replay') then
      assert not denied and result->'idempotent'='false'::jsonb,c;
      assert (select status='approved' and culqi_charge_id=charge and resolved_by=actor_id and resolution_source='external_authorized_reconciliation' from public.gift_card_culqi_attempts where id=aid);
      assert (select status='applied' and payment_state='applied' from public.gift_card_order_payments where order_id=oid);
      assert (select status='exhausted' and current_balance=0 from public.gift_cards where id=card);
      assert (select status='nuevo' and payment_status='paid' and culqi_charge_id=charge from public.orders where id=oid);
      assert (select count(*)=1 from public.gift_card_transactions where order_id=oid and movement_type='redemption' and amount=-40 and consumption_channel='online');
      assert (select count(*)=1 from public.gift_card_authorized_resolutions where attempt_id=aid and actor=actor_id and prior_state->>'resolution_source'='culqi_body_rejected');
      if c='partial_replay' then update public.gift_card_culqi_attempts set resolution_source='other' where id=aid; end if;
      if c='different_charge_replay' then e:=e||'{"charge_id":"chr_test_other"}'; end if;
      denied:=false;
      begin
        execute 'set local role service_role';
        result:=public.reconcile_externally_authorized_mixed_attempt(aid,checkout,case when c='different_charge_replay' then 'chr_test_other' else charge end,actor_id,e);
      exception when others then denied:=true;
      end;
      reset role;
      if c in ('partial_replay','different_charge_replay') then assert denied,c; else assert not denied and result->'idempotent'='true'::jsonb,c; end if;
      assert (select count(*)=1 from public.gift_card_authorized_resolutions where attempt_id=aid);
      assert (select count(*)=1 from public.gift_card_transactions where order_id=oid);
    else
      assert denied,c||' unexpectedly accepted';
      assert not exists(select 1 from public.gift_card_authorized_resolutions where attempt_id=aid),c;
      assert (select current_balance=balance_before from public.gift_cards where id=card),c;
      assert (select status=case when c='released' then 'released' else 'reserved' end from public.gift_card_order_payments where order_id=oid),c;
      assert (select culqi_charge_id is null from public.orders where id=oid),c;
      assert (select count(*)=case when c='redemption' then 1 else 0 end from public.gift_card_transactions where order_id=oid),c;
      if c='fault' then
        assert (select status='rejected' and resolution_source='culqi_body_rejected' and culqi_charge_id is null from public.gift_card_culqi_attempts where id=aid),c;
        assert (select payment_status='pending' from public.orders where id=oid),c;
      end if;
    end if;
    perform set_config('blackcat.test_fail_authorized_audit','off',true);
    update public.staff_profiles set role='admin',active=true where user_id=actor_id;
    checks:=checks+1;
  end loop;
  raise notice 'Authorized reconciliation SQL PASS: % scenarios + ACL + replay + atomic rollback',checks;
end $test$;
rollback;
select 'external-authorized-reconciliation SQL PASS: 27 scenarios, ACL, replay and atomic rollback' as result;
