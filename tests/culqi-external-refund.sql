-- Synthetic only; entire fixture and any temporary admission changes ROLLBACK.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $test$
declare
  v_admin uuid:=gen_random_uuid(); v_manager uuid:=gen_random_uuid(); v_staff uuid:=gen_random_uuid();
  v_inactive uuid:=gen_random_uuid(); v_none uuid:=gen_random_uuid(); v_card uuid; v_order uuid; v_checkout uuid; v_attempt uuid;
  v_case text; v_charge text; v_result jsonb; v_repeat jsonb; v_intent uuid; v_token uuid; v_role text;
  v_before numeric; v_ledger integer; v_count integer; v_checks integer:=0; v_denied boolean; v_payment_before jsonb;
begin
  insert into auth.users(id,email) values(v_admin,'refund-admin-'||v_admin||'@example.invalid'),
    (v_manager,'refund-manager-'||v_manager||'@example.invalid'),(v_staff,'refund-staff-'||v_staff||'@example.invalid'),
    (v_inactive,'refund-inactive-'||v_inactive||'@example.invalid'),(v_none,'refund-none-'||v_none||'@example.invalid');
  insert into public.staff_profiles(user_id,display_name,role,active) values(v_admin,'Synthetic admin','admin',true),
    (v_manager,'Synthetic manager','manager',true),(v_staff,'Synthetic staff','staff',true),(v_inactive,'Synthetic inactive','admin',false);
  -- Existing admission triggers require this only during synthetic setup, never persist it.
  update public.app_settings set value='{"gift_card_sales_enabled":false,"gift_card_redemption_enabled":true}'::jsonb where key='gift_card_operations';
  foreach v_case in array array['positive','manager','not_rejected','gift_pending','not_refunded','missing_refund_movement',
    'wrong_split','not_approved','staff','inactive','no_profile','already_completed','concurrent','pending','rejected','uncertain'] loop
    v_checkout:=gen_random_uuid(); v_charge:='chr_test_'||replace(v_checkout::text,'-','');
    insert into public.gift_cards(code,initial_balance,current_balance,status,purchaser_name,activated_at,expires_at)
      values('STG-REFUND-'||v_checkout,50,40,'active','Synthetic only',now(),now()+interval '45 days') returning id into v_card;
    insert into public.orders(order_number,checkout_id,customer_name,customer_phone,order_type,payment_method,payment_status,status,
      subtotal,total,gift_card_id,gift_card_amount,other_payment_amount,other_payment_method,culqi_order_id,culqi_charge_id,
      gift_card_refund_status,external_payment_refund_status)
      values('STG-REFUND-'||v_checkout,v_checkout,'Synthetic only','000000000','pick_up','gift_card_culqi','refund_pending','rechazado',
        50,50,v_card,40,10,'culqi','ord_test_'||replace(v_checkout::text,'-',''),v_charge,'completed','pending') returning id into v_order;
    insert into public.gift_card_order_payments(checkout_id,order_id,gift_card_id,gift_amount,other_amount,status,payment_state,applied_at,refunded_at)
      values(v_checkout,v_order,v_card,40,10,'refunded','applied',now(),now());
    insert into public.gift_card_culqi_attempts(checkout_id,order_id,culqi_order_id,gift_amount,culqi_amount,status,culqi_charge_id)
      values(v_checkout,v_order,'ord_test_'||replace(v_checkout::text,'-',''),40,10,'approved',v_charge) returning id into v_attempt;
    insert into public.gift_card_transactions(gift_card_id,movement_type,amount,balance_before,balance_after,reference,performed_by,consumption_channel,order_id,source_reference)
      values(v_card,'redemption',-40,40,0,'synthetic-use-'||v_checkout,v_admin,'online',v_order,'synthetic-test');
    if v_case<>'missing_refund_movement' then
      insert into public.gift_card_transactions(gift_card_id,movement_type,amount,balance_before,balance_after,reference,performed_by,consumption_channel,order_id,source_reference)
        values(v_card,'refund',40,0,40,'synthetic-refund-'||v_checkout,v_admin,'online',v_order,'synthetic-test');
    end if;
    if v_case='not_rejected' then update public.orders set status='nuevo' where id=v_order;
    elsif v_case='gift_pending' then update public.orders set gift_card_refund_status='pending' where id=v_order;
    elsif v_case='not_refunded' then update public.gift_card_order_payments set status='applied' where order_id=v_order;
    elsif v_case='wrong_split' then update public.gift_card_order_payments set other_amount=11 where order_id=v_order;
    elsif v_case='not_approved' then update public.gift_card_culqi_attempts set status='rejected' where id=v_attempt;
    elsif v_case='already_completed' then update public.orders set external_payment_refund_status='completed' where id=v_order;
    end if;
    select current_balance into v_before from public.gift_cards where id=v_card;
    select count(*) into v_ledger from public.gift_card_transactions where gift_card_id=v_card;
    select to_jsonb(p) into v_payment_before from public.gift_card_order_payments p where order_id=v_order;
    execute 'set local role service_role';
    if v_case in ('positive','manager','concurrent','pending','rejected','uncertain') then
      v_result:=public.prepare_external_refund(v_order,case when v_case='manager' then v_manager else v_admin end,'Synthetic stock rejection external refund.',true);
      v_intent:=(v_result->'intent'->>'id')::uuid; v_token:=(v_result->>'claim_token')::uuid;
      assert v_result->>'may_submit'='true';
      assert (v_result->'intent'->>'amount_cents')::bigint=1000;
      assert not(v_result->'intent' ? 'claim_token');
      v_repeat:=public.prepare_external_refund(v_order,v_admin,'Concurrent/repeated synthetic preparation.',true);
      assert v_repeat->>'may_submit'='false' and not(v_repeat ? 'claim_token');
      assert public.claim_external_refund_post(v_order,v_intent,v_admin,gen_random_uuid()) is false;
      assert public.claim_external_refund_post(v_order,v_intent,v_admin,v_token) is true;
      assert public.claim_external_refund_post(v_order,v_intent,v_admin,v_token) is false;
      v_checks:=v_checks+7;
      if v_case='pending' then
        v_repeat:=public.record_external_refund(v_order,v_intent,v_admin,'pending','ref_test_'||replace(v_checkout::text,'-',''),1000,v_charge,'Pendiente',201,null);
        assert v_repeat->>'state'='pending';
        assert (select external_payment_refund_status='pending' and payment_status='refund_pending' from public.orders where id=v_order);
        v_checks:=v_checks+2;
      elsif v_case='rejected' then
        v_repeat:=public.record_external_refund(v_order,v_intent,v_admin,'rejected','ref_test_'||replace(v_checkout::text,'-',''),1000,v_charge,'Rechazado',201,null);
        assert v_repeat->>'state'='rejected';
        assert (select external_payment_refund_status='pending' from public.orders where id=v_order);
        v_checks:=v_checks+2;
      elsif v_case='uncertain' then
        v_repeat:=public.record_external_refund(v_order,v_intent,v_admin,'reconciliation_required',null,1000,v_charge,null,null,'provider_timeout_or_network_error');
        assert v_repeat->>'state'='reconciliation_required';
        assert (select external_payment_refund_status='pending' from public.orders where id=v_order);
        v_checks:=v_checks+2;
      else
        -- Invalid amount, currency/environment, HTTP/status evidence cannot close an order.
        foreach v_role in array array['amount','foreign_charge','foreign_refund','pending_as_completed','no_http'] loop
          v_denied:=false;
          begin
            perform public.record_external_refund(v_order,v_intent,v_admin,'completed',
              case when v_role='foreign_refund' then 'ref_live_OTHER' else 'ref_test_'||replace(v_checkout::text,'-','') end,
              case when v_role='amount' then 2000 else 1000 end,case when v_role='foreign_charge' then 'chr_test_OTHER' else v_charge end,
              case when v_role='pending_as_completed' then 'Pendiente' else 'Completa' end,case when v_role='no_http' then null else 201 end,null);
          exception when others then
            if SQLERRM not in ('Refund evidence mismatch','Refund not terminally verified') then raise; end if;
            v_denied:=true;
          end;
          assert v_denied,'invalid completion accepted: '||v_role;
          v_checks:=v_checks+1;
        end loop;
        v_repeat:=public.record_external_refund(v_order,v_intent,v_admin,'completed','ref_test_'||replace(v_checkout::text,'-',''),1000,v_charge,'Completa',200,null);
        assert v_repeat->>'state'='completed';
        assert (select status='rechazado' and payment_status='refunded' and external_payment_refund_status='completed'
          and gift_card_refund_status='completed' from public.orders where id=v_order);
        select count(*) into v_count from public.culqi_external_refund_audit where intent_id=v_intent;
        assert public.record_external_refund(v_order,v_intent,v_admin,'completed','ref_test_'||replace(v_checkout::text,'-',''),1000,v_charge,'Completa',200,null)=v_repeat;
        assert (select count(*) from public.culqi_external_refund_audit where intent_id=v_intent)=v_count;
        assert (public.prepare_external_refund(v_order,v_admin,'Completed repeat must not POST or rewrite audit.',true)->>'may_submit')='false';
        v_checks:=v_checks+5;
      end if;
    else
      v_denied:=false;
      begin
        perform public.prepare_external_refund(v_order,case v_case when 'staff' then v_staff when 'inactive' then v_inactive when 'no_profile' then v_none else v_admin end,'Synthetic negative external refund case.',true);
      exception when others then
        if SQLERRM not in ('Audited refund authorization required','Order not eligible for external refund','Refund financial relationships do not match') then raise; end if;
        v_denied:=true;
      end;
      assert v_denied,'unsafe prepare allowed: '||v_case;
      assert not exists(select 1 from public.culqi_external_refunds where order_id=v_order);
      v_checks:=v_checks+2;
    end if;
    assert (select current_balance from public.gift_cards where id=v_card)=v_before,'Gift Card balance changed';
    assert (select count(*) from public.gift_card_transactions where gift_card_id=v_card)=v_ledger,'ledger changed';
    assert (select to_jsonb(p) from public.gift_card_order_payments p where order_id=v_order)=v_payment_before,'reservation changed';
    v_checks:=v_checks+3;
    execute 'reset role';
  end loop;
  foreach v_role in array array['anon','authenticated'] loop
    assert not has_function_privilege(v_role,'public.prepare_external_refund(uuid,uuid,text,boolean)','EXECUTE');
    assert not has_function_privilege(v_role,'public.claim_external_refund_post(uuid,uuid,uuid,uuid)','EXECUTE');
    assert not has_function_privilege(v_role,'public.record_external_refund(uuid,uuid,uuid,text,text,bigint,text,text,integer,text)','EXECUTE');
    assert not has_table_privilege(v_role,'public.culqi_external_refunds','SELECT');
    v_checks:=v_checks+4;
  end loop;
  assert not has_table_privilege('service_role','public.culqi_external_refunds','DELETE');
  assert not has_table_privilege('service_role','public.culqi_external_refunds','TRUNCATE');
  assert not has_table_privilege('service_role','public.culqi_external_refund_audit','UPDATE');
  assert not has_table_privilege('service_role','public.culqi_external_refund_audit','DELETE');
  v_checks:=v_checks+4;
  perform set_config('test.external_refund_checks',v_checks::text,true);
end $test$;
select current_setting('test.external_refund_checks') AS external_refund_assertions_passed;
rollback;
