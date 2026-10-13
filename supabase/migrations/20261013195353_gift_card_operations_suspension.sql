-- Additive admission controls. Apply after the six Phase 2 migrations.
-- No gate on finalization, application of existing reservations, release or reconciliation.
alter table public.app_settings add constraint app_settings_gift_card_operations_shape check (
  key <> 'gift_card_operations' or (
    jsonb_typeof(value) = 'object'
    and value ?& array['gift_card_sales_enabled','gift_card_redemption_enabled']
    and jsonb_typeof(value->'gift_card_sales_enabled') = 'boolean'
    and jsonb_typeof(value->'gift_card_redemption_enabled') = 'boolean'
  )
);

create table public.gift_card_operation_audit (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id) on delete set null,
  actor_role text not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_value jsonb,
  new_value jsonb,
  occurred_at timestamptz not null default clock_timestamp()
);
alter table public.gift_card_operation_audit enable row level security;
revoke all on public.gift_card_operation_audit from public, anon, authenticated, service_role;
grant select on public.gift_card_operation_audit to authenticated, service_role;
revoke all on sequence public.gift_card_operation_audit_id_seq from public,anon,authenticated,service_role;
create policy gift_card_operation_audit_admin_read on public.gift_card_operation_audit for select to authenticated
  using ((select private.current_staff_role()) in ('admin','manager'));

create policy gift_card_operation_settings_admin_read on public.app_settings for select to authenticated
  using (key='gift_card_operations' and (select private.current_staff_role()) in ('admin','manager'));
-- Existing UPDATE table grant is reused; other keys/policies remain unchanged.
create policy gift_card_operation_settings_admin_update on public.app_settings for update to authenticated
  using (key='gift_card_operations' and (select private.current_staff_role()) in ('admin','manager'))
  with check (key='gift_card_operations' and updated_by=(select auth.uid())
    and (select private.current_staff_role()) in ('admin','manager'));

create function private.audit_gift_card_operations() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_role text := current_setting('role',true); v_old jsonb; v_new jsonb; v_actor uuid;
begin
  if tg_op='DELETE' then
    if old.key<>'gift_card_operations' then return old; end if;
    v_old:=old.value;
  else
    if tg_op='UPDATE' and old.key='gift_card_operations' and new.key<>old.key then
      raise exception 'Gift Card operations key cannot be renamed';
    end if;
    if new.key<>'gift_card_operations' then return new; end if;
    if v_role='authenticated' then
      if coalesce(private.current_staff_role(),'') not in ('admin','manager') then raise exception 'No autorizado'; end if;
      new.updated_by:=auth.uid();
    end if;
    new.updated_at:=clock_timestamp();
    v_new:=new.value;
    v_actor:=new.updated_by;
    if tg_op='UPDATE' then v_old:=old.value; end if;
  end if;
  if tg_op<>'UPDATE' or v_old is distinct from v_new then
    insert into public.gift_card_operation_audit(actor,actor_role,action,old_value,new_value)
      values(case when v_role='authenticated' then auth.uid() else v_actor end,
        case when coalesce(v_role,'none')='none' then session_user else v_role end,tg_op,v_old,v_new);
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.audit_gift_card_operations() from public, anon, authenticated, service_role;
create trigger app_settings_gift_card_operations_audit before insert or update or delete on public.app_settings
  for each row execute function private.audit_gift_card_operations();

insert into public.app_settings(key,value) values('gift_card_operations',
  '{"gift_card_sales_enabled":false,"gift_card_redemption_enabled":false}'::jsonb);

create function public.set_gift_card_operation(p_flag text,p_enabled boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_value jsonb;
begin
  if current_setting('role',true) is distinct from 'service_role'
     and coalesce(private.current_staff_role(),'') not in ('admin','manager') then raise exception 'No autorizado'; end if;
  if p_flag is null or p_flag not in ('gift_card_sales_enabled','gift_card_redemption_enabled') or p_enabled is null then
    raise exception 'Invalid Gift Card operation flag';
  end if;
  select value into v_value from public.app_settings where key='gift_card_operations' for update;
  if not found then raise exception 'Gift Card settings unavailable'; end if;
  update public.app_settings set value=jsonb_set(value,array[p_flag],to_jsonb(p_enabled)),updated_by=auth.uid()
    where key='gift_card_operations' returning value into v_value;
  return v_value;
end $$;
revoke all on function public.set_gift_card_operation(text,boolean) from public, anon;
grant execute on function public.set_gift_card_operation(text,boolean) to authenticated,service_role;

create function private.gift_card_entry_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_flag text; v_value jsonb;
begin
  if tg_table_name='gift_card_purchases' then
    -- An INSERT ... ON CONFLICT retry does not constitute a new purchase.
    if exists(select 1 from public.gift_card_purchases where checkout_id=new.checkout_id) then return new; end if;
    v_flag:='gift_card_sales_enabled';
  elsif tg_table_name='gift_card_transactions' then
    -- Online completion belongs to a previously admitted reservation. Never block it.
    if new.movement_type<>'redemption' or new.consumption_channel<>'in_store' then return new; end if;
    v_flag:='gift_card_redemption_enabled';
  else
    v_flag:='gift_card_redemption_enabled';
  end if;
  -- Serialize admission with flag changes; no cache, no release side effect.
  select value into v_value from public.app_settings where key='gift_card_operations' for share;
  if coalesce(v_value->v_flag,'false'::jsonb) is distinct from 'true'::jsonb then
    raise exception using errcode='P0001',message='New Gift Card operations are suspended';
  end if;
  return new;
end $$;
revoke all on function private.gift_card_entry_guard() from public,anon,authenticated,service_role;
create trigger gift_card_purchase_admission before insert on public.gift_card_purchases
  for each row execute function private.gift_card_entry_guard();
create trigger gift_card_reservation_admission before insert on public.gift_card_order_payments
  for each row execute function private.gift_card_entry_guard();
create trigger gift_card_mixed_attempt_admission before insert on public.gift_card_culqi_attempts
  for each row execute function private.gift_card_entry_guard();
create trigger gift_card_manual_redemption_admission before insert on public.gift_card_transactions
  for each row execute function private.gift_card_entry_guard();
