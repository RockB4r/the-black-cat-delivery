-- Run in the Supabase SQL editor after the unblock migration.
-- All test rows are rolled back. Requires active admin, manager and staff profiles.
begin;

select set_config('gift_test.admin_uid', (select user_id::text from public.staff_profiles where role = 'admin' and active = true limit 1), true);
select set_config('gift_test.manager_uid', (select user_id::text from public.staff_profiles where role = 'manager' and active = true limit 1), true);
select set_config('gift_test.staff_uid', (select user_id::text from public.staff_profiles where role = 'staff' and active = true limit 1), true);

set local role authenticated;

do $$
declare
  v_card public.gift_cards;
  v_audit record;
begin
  perform set_config('request.jwt.claim.sub', current_setting('gift_test.admin_uid'), true);
  v_card := public.create_gift_card(50, 'Gift Card test: reversible', null, null, null, null, true);
  v_card := public.block_gift_card(v_card.id);
  if v_card.status <> 'blocked' or v_card.current_balance <> 50 then
    raise exception 'Blocking changed the wrong state or balance';
  end if;

  begin
    perform public.redeem_gift_card(v_card.id, 10, 'blocked-test', null);
    raise exception 'A blocked card was redeemed';
  exception when others then
    if sqlerrm <> 'Gift Card no disponible' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', current_setting('gift_test.staff_uid'), true);
  begin
    perform public.unblock_gift_card(v_card.id);
    raise exception 'Staff was allowed to unblock';
  exception when others then
    if sqlerrm <> 'No autorizado' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', current_setting('gift_test.manager_uid'), true);
  v_card := public.unblock_gift_card(v_card.id);
  if v_card.status <> 'active' or v_card.current_balance <> 50 then
    raise exception 'Unblocking changed the wrong state or balance';
  end if;

  select count(*) as movements, count(distinct performed_by) as actors, min(created_at) as first_at
    into v_audit
  from public.gift_card_transactions
  where gift_card_id = v_card.id
    and movement_type in ('block', 'unblock')
    and amount = 0 and balance_before = 50 and balance_after = 50;
  if v_audit.movements <> 2 or v_audit.actors <> 2 or v_audit.first_at is null then
    raise exception 'Block/unblock audit is incomplete';
  end if;

  perform set_config('request.jwt.claim.sub', current_setting('gift_test.admin_uid'), true);
  v_card := public.create_gift_card(50, 'Gift Card test: expired', null, null, null, null, true);
  perform public.block_gift_card(v_card.id);
  perform set_config('gift_test.expired_card_id', v_card.id::text, true);

  v_card := public.create_gift_card(75, 'Gift Card test: no balance', null, null, null, null, true);
  perform public.block_gift_card(v_card.id);
  perform set_config('gift_test.empty_card_id', v_card.id::text, true);

  v_card := public.create_gift_card(100, 'Gift Card test: exhausted', null, null, null, null, true);
  perform public.redeem_gift_card(v_card.id, 100, 'exhausted-test', null);
  begin
    perform public.unblock_gift_card(v_card.id);
    raise exception 'An exhausted card was reactivated';
  exception when others then
    if sqlerrm <> 'Solo se puede desbloquear una Gift Card bloqueada' then raise; end if;
  end;
end $$;

-- Simulate legacy/anomalous blocked rows that have expired or lost their balance.
set local role postgres;
update public.gift_cards set expires_at = now() - interval '1 minute'
  where id = current_setting('gift_test.expired_card_id')::uuid;
update public.gift_cards set current_balance = 0
  where id = current_setting('gift_test.empty_card_id')::uuid;
set local role authenticated;

do $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('gift_test.admin_uid'), true);
  begin
    perform public.unblock_gift_card(current_setting('gift_test.expired_card_id')::uuid);
    raise exception 'An expired card was reactivated';
  exception when others then
    if sqlerrm <> 'No se puede desbloquear una Gift Card vencida' then raise; end if;
  end;
  begin
    perform public.unblock_gift_card(current_setting('gift_test.empty_card_id')::uuid);
    raise exception 'A zero-balance card was reactivated';
  exception when others then
    if sqlerrm <> 'No se puede desbloquear una Gift Card sin saldo' then raise; end if;
  end;
end $$;

rollback;
