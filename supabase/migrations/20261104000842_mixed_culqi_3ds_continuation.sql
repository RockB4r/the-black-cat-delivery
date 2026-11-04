-- STAGING FIRST. Additive 3DS phases; existing processing status keeps all release gates active.
alter table public.gift_card_culqi_attempts
  add column three_ds_phase text check (three_ds_phase in ('initial_request_sent','awaiting_3ds','authenticated_request_sent','authentication_failed')),
  add column three_ds_context_hash text check (three_ds_context_hash ~ '^[a-f0-9]{64}$'),
  add column three_ds_continuation_hash text check (three_ds_continuation_hash ~ '^[a-f0-9]{64}$'),
  add column three_ds_expires_at timestamptz,
  add column three_ds_updated_at timestamptz,
  add constraint gift_card_3ds_context_complete check (
    (three_ds_phase is null and three_ds_context_hash is null and three_ds_continuation_hash is null and three_ds_expires_at is null and three_ds_updated_at is null)
    or (three_ds_phase is not null and three_ds_context_hash is not null and three_ds_continuation_hash is not null and three_ds_expires_at is not null and three_ds_updated_at is not null));

create function public.transition_mixed_culqi_3ds(p_order_id uuid,p_attempt_id uuid,p_context_hash text,p_continuation_hash text,p_transition text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare o public.orders; p public.gift_card_order_payments; a public.gift_card_culqi_attempts;
begin
  -- Same lock order as begin/complete/mark/clear: order, reservation, attempt.
  select * into o from public.orders where id=p_order_id for update;
  select * into p from public.gift_card_order_payments where order_id=p_order_id for update;
  select * into a from public.gift_card_culqi_attempts where id=p_attempt_id for update;
  if o.id is null or p.order_id is null or a.id is null or a.order_id<>o.id
    or o.checkout_id is distinct from a.checkout_id or p.checkout_id is distinct from a.checkout_id
    or o.culqi_order_id is distinct from a.culqi_order_id or a.gift_amount<>p.gift_amount or a.culqi_amount<>p.other_amount
    or o.gift_card_id is distinct from p.gift_card_id or o.gift_card_amount<>p.gift_amount
    or o.other_payment_amount<>p.other_amount or o.total<>p.gift_amount+p.other_amount
    or o.status in ('rechazado','cancelado')
    or o.payment_status<>'pending' or p.status<>'reserved' or a.status<>'processing'
    or o.culqi_charge_id is not null or a.culqi_charge_id is not null
    or p_context_hash is null or p_context_hash !~ '^[a-f0-9]{64}$'
    or p_continuation_hash is null or p_continuation_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  if p_transition='initialize' then
    if a.three_ds_phase is not null or p.expires_at<=now() then return false; end if;
    update public.gift_card_culqi_attempts set three_ds_phase='initial_request_sent',
      three_ds_context_hash=p_context_hash,three_ds_continuation_hash=p_continuation_hash,
      three_ds_expires_at=least(p.expires_at,now()+interval '10 minutes'),three_ds_updated_at=now() where id=a.id;
    return true;
  end if;
  if a.three_ds_context_hash is distinct from p_context_hash or a.three_ds_continuation_hash is distinct from p_continuation_hash then return false; end if;
  if p_transition='await' and a.three_ds_phase='initial_request_sent' and a.three_ds_expires_at>now() then
    update public.gift_card_culqi_attempts set three_ds_phase='awaiting_3ds',three_ds_updated_at=now() where id=a.id;
    return true;
  elsif p_transition='continue' and a.three_ds_phase='awaiting_3ds' and a.three_ds_expires_at>now() then
    update public.gift_card_culqi_attempts set three_ds_phase='authenticated_request_sent',three_ds_updated_at=now() where id=a.id;
    return true;
  elsif p_transition='cancel' and a.three_ds_phase='awaiting_3ds' then
    update public.gift_card_culqi_attempts set three_ds_phase='authentication_failed',three_ds_updated_at=now(),
      status='reconciliation_required',resolution_source='culqi_3ds_cancelled' where id=a.id;
    update public.gift_card_order_payments set payment_state='reconciliation_required' where order_id=o.id;
    return true;
  end if;
  return false;
end $$;
revoke all on function public.transition_mixed_culqi_3ds(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.transition_mixed_culqi_3ds(uuid,uuid,text,text,text) to service_role;
