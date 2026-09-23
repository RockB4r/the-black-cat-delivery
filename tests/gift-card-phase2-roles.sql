-- Local/staging only after A-D. Never execute on production. Transaction rolls back.
-- Requires one active admin, manager and staff profile in the test database.
begin;
select set_config('gift_test.admin_uid', (select user_id::text from public.staff_profiles where role='admin' and active limit 1), true);
select set_config('gift_test.manager_uid', (select user_id::text from public.staff_profiles where role='manager' and active limit 1), true);
select set_config('gift_test.staff_uid', (select user_id::text from public.staff_profiles where role='staff' and active limit 1), true);
select set_config('gift_test.no_profile_uid', gen_random_uuid()::text, true);
set local role authenticated;

do $$
declare v_card public.gift_cards; v_role text; v_uid text;
begin
  if current_setting('gift_test.admin_uid', true) is null
    or current_setting('gift_test.manager_uid', true) is null
    or current_setting('gift_test.staff_uid', true) is null then
    raise exception 'Seed active admin, manager and staff profiles in local/staging first';
  end if;
  perform set_config('request.jwt.claim.sub',current_setting('gift_test.admin_uid'),true);
  v_card:=public.create_gift_card(50,'Phase 2 role test');
  for v_role,v_uid in
    select * from (values
      ('staff',current_setting('gift_test.staff_uid')),
      ('no_profile',current_setting('gift_test.no_profile_uid'))
    ) as denied(role_name,user_id)
  loop
    perform set_config('request.jwt.claim.sub',v_uid,true);
    begin
      perform public.block_gift_card(v_card.id);
      raise exception '% was allowed to block',v_role;
    exception when others then
      if sqlerrm<>'No autorizado' then raise; end if;
    end;
  end loop;
  perform set_config('request.jwt.claim.sub',current_setting('gift_test.admin_uid'),true);
  v_card:=public.block_gift_card(v_card.id);
  if v_card.status<>'blocked' then raise exception 'Admin could not block'; end if;
  perform public.unblock_gift_card(v_card.id);
  perform set_config('request.jwt.claim.sub',current_setting('gift_test.manager_uid'),true);
  v_card:=public.block_gift_card(v_card.id);
  if v_card.status<>'blocked' then raise exception 'Manager could not block'; end if;
end $$;
rollback;
