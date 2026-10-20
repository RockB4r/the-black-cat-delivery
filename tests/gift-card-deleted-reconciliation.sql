-- STAGING ONLY. Run on kqfphrukxdvlrbjipjnx. Every fixture/flag change rolls back.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $test$
declare
  v_case text; v_actor uuid; v_card uuid; v_order uuid; v_checkout uuid; v_attempt uuid;
  v_other_order uuid; v_other_checkout uuid; v_result boolean; v_denied boolean;
  v_audit jsonb; v_checks integer:=0; v_culqi text;
begin
  select user_id into v_actor from public.staff_profiles where role='admin' and active limit 1;
  assert v_actor is not null, 'synthetic staging Admin required';
  assert not has_function_privilege('anon','public.clear_mixed_culqi_attempt(uuid,uuid,uuid,text)','EXECUTE');
  assert not has_function_privilege('authenticated','public.clear_mixed_culqi_attempt(uuid,uuid,uuid,text)','EXECUTE');
  assert has_function_privilege('service_role','public.clear_mixed_culqi_attempt(uuid,uuid,uuid,text)','EXECUTE');
  assert (select not prosecdef and pg_get_userbyid(proowner)='postgres' and proconfig=array['search_path=""']
    from pg_proc where oid='public.clear_mixed_culqi_attempt(uuid,uuid,uuid,text)'::regprocedure), 'RPC security changed';
  v_checks:=v_checks+4;
  foreach v_case in array array['rejected','processing','reconciliation_required','redemption','other_checkout',
    'applied','released','approved','paid_order','linked_charge','amount_mismatch','other_approved','concurrent','missing_actor'] loop
    -- Admit synthetic reservations only inside this transaction; clear must work with flags OFF.
    update public.app_settings set value='{"gift_card_sales_enabled":false,"gift_card_redemption_enabled":true}'::jsonb
      where key='gift_card_operations';
    v_checkout:=gen_random_uuid(); v_culqi:='ord_test_'||replace(v_checkout::text,'-','');
    insert into public.gift_cards(code,initial_balance,current_balance,status,purchaser_name,activated_at,expires_at,online_payment_code)
      values('STG-CLEAR-'||v_checkout::text,40,40,'active','Synthetic only',now(),now()+interval '45 days',encode(extensions.gen_random_bytes(16),'hex'))
      returning id into v_card;
    insert into public.orders(order_number,checkout_id,customer_name,customer_phone,order_type,payment_method,payment_status,
      subtotal,total,gift_card_id,gift_card_amount,other_payment_amount,other_payment_method,culqi_order_id)
      values('STG-CLEAR-'||v_checkout::text,v_checkout,'Synthetic only','000000000','pick_up','gift_card_culqi','pending',50,50,v_card,40,10,'culqi',v_culqi)
      returning id into v_order;
    insert into public.gift_card_order_payments(checkout_id,order_id,gift_card_id,gift_amount,other_amount,payment_state)
      values(v_checkout,v_order,v_card,40,10,'failed');
    insert into public.gift_card_culqi_attempts(checkout_id,order_id,culqi_order_id,gift_amount,culqi_amount,status,resolution_source)
      values(v_checkout,v_order,v_culqi,40,10,case when v_case in ('processing','reconciliation_required') then v_case else 'rejected' end,'test_http_4xx')
      returning id into v_attempt;
    if v_case='redemption' then
      insert into public.gift_card_transactions(gift_card_id,movement_type,amount,balance_before,balance_after,reference,performed_by,consumption_channel,order_id)
        values(v_card,'redemption',-1,40,39,'Synthetic pre-existing redemption',v_actor,'online',v_order);
    elsif v_case='other_checkout' then
      v_other_checkout:=gen_random_uuid();
      insert into public.orders(order_number,checkout_id,customer_name,customer_phone,order_type,payment_method,payment_status,subtotal,total)
        values('STG-CLEAR-OTHER-'||v_other_checkout::text,v_other_checkout,'Synthetic only','000000000','pick_up','wallet','pending',50,50)
        returning id into v_other_order;
      insert into public.gift_card_order_payments(checkout_id,order_id,gift_card_id,gift_amount,other_amount)
        values(v_other_checkout,v_other_order,v_card,40,10);
      update public.gift_card_culqi_attempts set checkout_id=v_other_checkout where id=v_attempt;
    elsif v_case in ('applied','released') then
      update public.gift_card_order_payments set status=v_case where order_id=v_order;
    elsif v_case='approved' then
      update public.gift_card_culqi_attempts set status='approved' where id=v_attempt;
    elsif v_case='paid_order' then
      update public.orders set payment_status='paid' where id=v_order;
    elsif v_case='linked_charge' then
      update public.orders set culqi_charge_id='chr_test_'||replace(v_checkout::text,'-','') where id=v_order;
    elsif v_case='amount_mismatch' then
      update public.gift_card_culqi_attempts set gift_amount=39 where id=v_attempt;
    elsif v_case in ('other_approved','concurrent') then
      insert into public.gift_card_culqi_attempts(checkout_id,order_id,culqi_order_id,gift_amount,culqi_amount,status)
        values(v_checkout,v_order,v_culqi,40,10,case when v_case='concurrent' then 'processing' else 'approved' end);
    end if;
    update public.app_settings set value='{"gift_card_sales_enabled":false,"gift_card_redemption_enabled":false}'::jsonb
      where key='gift_card_operations';
    execute 'set local role service_role';
    if v_case in ('rejected','processing','reconciliation_required') then
      v_result:=public.clear_mixed_culqi_attempt(v_order,v_attempt,v_actor,'Synthetic deleted/expired order; charge paid=false and denied; no approved charge.');
      assert v_result is true, 'clear returned false'; v_checks:=v_checks+1;
      select to_jsonb(a) into v_audit from public.gift_card_culqi_attempts a where id=v_attempt;
      assert v_audit->>'status'='cleared_no_charge' and (v_audit->>'resolved_by')::uuid=v_actor
        and v_audit->>'resolution_source'='manual' and v_audit->>'resolved_at' is not null
        and position('previous_status='||v_case in v_audit->>'resolution_note')>0
        and position('previous_source=test_http_4xx' in v_audit->>'resolution_note')>0, 'audit incomplete';
      assert (select status='released' and payment_state='released' from public.gift_card_order_payments where order_id=v_order), 'reservation not released';
      assert (select status='active' and current_balance=40 from public.gift_cards where id=v_card), 'balance/status changed';
      assert (select coalesce(sum(gift_amount),0) from public.gift_card_order_payments where gift_card_id=v_card and status='reserved')=0, 'available not 40';
      assert (select payment_status='expired' and status<>'confirmed' from public.orders where id=v_order), 'order incorrectly paid';
      assert (select count(*) from public.gift_card_transactions where order_id=v_order)=0, 'release created movement';
      v_checks:=v_checks+6;
      assert public.clear_mixed_culqi_attempt(v_order,v_attempt,v_actor,'Second call must be a no-op, never a second release') is true;
      assert (select to_jsonb(a) from public.gift_card_culqi_attempts a where id=v_attempt)=v_audit, 'idempotent call rewrote audit';
      assert (select current_balance from public.gift_cards where id=v_card)=40, 'duplicate release altered balance';
      assert (select count(*) from public.gift_card_transactions where order_id=v_order)=0, 'duplicate movement';
      v_checks:=v_checks+4;
    else
      v_denied:=false;
      begin
        perform public.clear_mixed_culqi_attempt(v_order,v_attempt,case when v_case='missing_actor' then null else v_actor end,'Synthetic negative test: do not clear this operation.');
      exception when others then
        if SQLERRM not in ('Attempt cannot be cleared','Audited decision required') then raise; end if;
        v_denied:=true;
      end;
      assert v_denied, 'unsafe case was accepted: '||v_case;
      assert (select status<>'cleared_no_charge' from public.gift_card_culqi_attempts where id=v_attempt), 'failed clear mutated attempt';
      assert (select current_balance from public.gift_cards where id=v_card)=40, 'failed clear mutated balance';
      v_checks:=v_checks+3;
    end if;
    execute 'reset role';
  end loop;
  perform set_config('test.deleted_reconciliation_checks',v_checks::text,true);
end $test$;
select current_setting('test.deleted_reconciliation_checks')::integer as checks_passed;
rollback;
