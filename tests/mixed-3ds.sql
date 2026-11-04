-- Synthetic staging-only validation. No provider calls. All fixtures/changes roll back.
begin;
do $$
declare
  card_id uuid; oid uuid; checkout uuid; aid uuid; result jsonb; blocked boolean; scenario integer;
  ctx text:=repeat('a',64); capability text:=repeat('b',64);
begin
  assert not has_function_privilege('anon','public.transition_mixed_culqi_3ds(uuid,uuid,text,text,text)','EXECUTE');
  assert not has_function_privilege('authenticated','public.transition_mixed_culqi_3ds(uuid,uuid,text,text,text)','EXECUTE');
  assert has_function_privilege('service_role','public.transition_mixed_culqi_3ds(uuid,uuid,text,text,text)','EXECUTE');
  assert (select not f.prosecdef from pg_proc f where f.oid='public.transition_mixed_culqi_3ds(uuid,uuid,text,text,text)'::regprocedure);
  update public.app_settings set value='{"gift_card_sales_enabled":true,"gift_card_redemption_enabled":true}'::jsonb where key='gift_card_operations';
  for scenario in 1..7 loop
    checkout:=gen_random_uuid();
    insert into public.gift_cards(code,initial_balance,current_balance,status,purchaser_name,activated_at,expires_at,online_payment_code)
      values('BC-STG-3DS-'||left(checkout::text,8),40,40,'active','Synthetic 3DS',now(),now()+interval '45 days',md5(checkout::text)) returning id into card_id;
    insert into public.orders(order_number,customer_name,customer_phone,order_type,payment_method,payment_status,subtotal,total,
      gift_card_id,gift_card_amount,other_payment_amount,other_payment_method,checkout_id,culqi_order_id)
      values('TBC-STG-3DS-'||left(checkout::text,8),'Synthetic 3DS','000000000','pick_up','gift_card_culqi','pending',50,50,
      card_id,40,10,'culqi',checkout,'ord_test_3ds_'||left(checkout::text,8)) returning id into oid;
    insert into public.gift_card_order_payments(checkout_id,order_id,gift_card_id,gift_amount,other_amount) values(checkout,oid,card_id,40,10);
    select public.begin_mixed_culqi_attempt(oid,checkout,culqi_order_id) into result from public.orders where id=oid;
    aid:=(result->>'id')::uuid;
    assert public.transition_mixed_culqi_3ds(oid,aid,ctx,capability,'initialize');
    assert not public.transition_mixed_culqi_3ds(oid,aid,ctx,capability,'initialize');
    assert public.transition_mixed_culqi_3ds(oid,aid,ctx,capability,'await');
    assert (select status='processing' and three_ds_phase='awaiting_3ds' from public.gift_card_culqi_attempts where id=aid);
    assert not public.transition_mixed_culqi_3ds(oid,aid,repeat('c',64),capability,'continue');
    assert not public.transition_mixed_culqi_3ds(oid,aid,ctx,repeat('c',64),'continue');
    assert not public.transition_mixed_culqi_3ds(oid,gen_random_uuid(),ctx,capability,'continue');
    assert not public.transition_mixed_culqi_3ds(gen_random_uuid(),aid,ctx,capability,'continue');
    blocked:=false;
    begin perform public.release_gift_card_order_reservation(oid); exception when others then blocked:=true; end;
    assert blocked, 'awaiting_3ds allowed automatic release';
    if scenario=7 then
      update public.gift_card_culqi_attempts set three_ds_expires_at=now()-interval '1 second' where id=aid;
      assert not public.transition_mixed_culqi_3ds(oid,aid,ctx,capability,'continue');
    elsif scenario=4 then
      assert public.transition_mixed_culqi_3ds(oid,aid,ctx,capability,'cancel');
      assert not public.transition_mixed_culqi_3ds(oid,aid,ctx,capability,'continue');
      assert (select status='reconciliation_required' and three_ds_phase='authentication_failed' from public.gift_card_culqi_attempts where id=aid);
    else
      if scenario=2 then
        perform public.complete_mixed_culqi_attempt(oid,aid,(select culqi_order_id from public.orders where id=oid),null,'synthetic_webhook');
        assert not public.transition_mixed_culqi_3ds(oid,aid,ctx,capability,'continue');
      else
        assert public.transition_mixed_culqi_3ds(oid,aid,ctx,capability,'continue');
        assert not public.transition_mixed_culqi_3ds(oid,aid,ctx,capability,'continue'), 'second authenticated request allowed';
      end if;
      if scenario in (1,2,3) then
        if scenario=3 then perform public.complete_mixed_culqi_attempt(oid,aid,(select culqi_order_id from public.orders where id=oid),null,'synthetic_webhook'); end if;
        perform public.complete_mixed_culqi_attempt(oid,aid,'chr_test_3ds_'||left(checkout::text,8),'chr_test_3ds_'||left(checkout::text,8),'synthetic_http');
        result:=public.complete_mixed_culqi_attempt(oid,aid,'chr_test_3ds_'||left(checkout::text,8),'chr_test_3ds_'||left(checkout::text,8),'synthetic_duplicate');
        assert (result->>'idempotent')::boolean;
        assert (select count(*) from public.gift_card_transactions where order_id=oid and movement_type='redemption')=1;
        assert (select current_balance=0 and status='exhausted' from public.gift_cards where id=card_id);
        assert (select status='applied' from public.gift_card_order_payments where order_id=oid);
      elsif scenario=5 then perform public.mark_mixed_culqi_attempt(aid,'rejected','synthetic_3ds_declined');
      elsif scenario=6 then perform public.mark_mixed_culqi_attempt(aid,'reconciliation_required','synthetic_3ds_timeout'); end if;
    end if;
    if scenario>=4 then
      assert (select current_balance=40 from public.gift_cards where id=card_id);
      assert (select status='reserved' and gift_amount=40 from public.gift_card_order_payments where order_id=oid);
      assert (select count(*) from public.gift_card_transactions where order_id=oid)=0;
      assert not public.transition_mixed_culqi_3ds(oid,aid,ctx,capability,'continue');
    end if;
  end loop;
end $$;
rollback;
select 'mixed-3ds-sql-PASS: 7 scenarios, rollback complete' as result;
