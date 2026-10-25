-- STAGING FIRST. Additive external refunds only. No Gift Card/reservation/ledger writes.
create table public.culqi_external_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id),
  checkout_id uuid not null unique,
  order_number text not null,
  attempt_id uuid not null references public.gift_card_culqi_attempts(id),
  culqi_order_id text not null,
  charge_id text not null unique check (charge_id ~ '^chr_(test|live)_[A-Za-z0-9]+$'),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 99999900),
  currency text not null default 'PEN' check (currency='PEN'),
  reason text not null default 'solicitud_comprador' check (reason='solicitud_comprador'),
  state text not null check (state in ('processing','pending','completed','rejected','reconciliation_required')),
  refund_id text unique check (refund_id ~ '^ref_(test|live)_[A-Za-z0-9]+$'),
  claim_token uuid not null default gen_random_uuid(),
  post_started_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  provider_status text,
  provider_http integer,
  safe_error text,
  charge_since timestamptz not null
);
create table public.culqi_external_refund_audit (
  id bigint generated always as identity primary key,
  intent_id uuid not null references public.culqi_external_refunds(id),
  actor uuid not null references auth.users(id),
  event text not null check (event in ('prepared','post_authorized','observed')),
  old_state text,
  new_state text not null,
  refund_id text,
  provider_http integer,
  provider_status text,
  note text not null,
  occurred_at timestamptz not null default clock_timestamp()
);
alter table public.culqi_external_refunds enable row level security;
alter table public.culqi_external_refund_audit enable row level security;
revoke all on public.culqi_external_refunds,public.culqi_external_refund_audit from public,anon,authenticated,service_role;
grant select,insert,update on public.culqi_external_refunds to service_role;
grant select,insert on public.culqi_external_refund_audit to service_role;
revoke all on sequence public.culqi_external_refund_audit_id_seq from public,anon,authenticated,service_role;
grant usage,select on sequence public.culqi_external_refund_audit_id_seq to service_role;

-- Invoker-only backend helper. No new USAGE on private and no changes to existing RPCs.
create function public.external_refund_snapshot(p_order_id uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.orders; p public.gift_card_order_payments; a public.gift_card_culqi_attempts;
begin
  if not exists(select 1 from public.staff_profiles where user_id=p_actor and active and role in ('admin','manager')) then
    raise exception 'Refund operator not authorized';
  end if;
  select * into o from public.orders where id=p_order_id;
  select * into p from public.gift_card_order_payments where order_id=p_order_id;
  select * into a from public.gift_card_culqi_attempts where order_id=p_order_id and status='approved' and culqi_charge_id=o.culqi_charge_id;
  if o.id is null or o.status<>'rechazado' or o.payment_status<>'refund_pending'
    or o.external_payment_refund_status<>'pending' or o.checkout_id is null
    or o.culqi_charge_id is null or o.culqi_charge_id !~ '^chr_(test|live)_[A-Za-z0-9]+$'
    or o.gift_card_refund_status is distinct from 'completed'
    or p.order_id is null or p.status<>'refunded' or p.refunded_at is null
    or p.checkout_id is distinct from o.checkout_id or p.gift_card_id is distinct from o.gift_card_id
    or o.gift_card_amount is distinct from p.gift_amount or o.other_payment_amount is distinct from p.other_amount
    or p.other_amount<=0 or p.other_amount<>round(p.other_amount,2) or o.total is distinct from p.gift_amount+p.other_amount
    or a.id is null or a.checkout_id is distinct from o.checkout_id or a.culqi_order_id is distinct from o.culqi_order_id
    or a.gift_amount is distinct from p.gift_amount or a.culqi_amount is distinct from p.other_amount then
    raise exception 'Order not eligible for external refund';
  end if;
  if (select count(*) from public.gift_card_transactions t where t.order_id=o.id and t.gift_card_id=p.gift_card_id
      and t.movement_type='refund' and t.amount=p.gift_amount and t.balance_after=t.balance_before+t.amount)<>1
    or (select count(*) from public.gift_card_transactions t where t.order_id=o.id and t.gift_card_id=p.gift_card_id
      and t.movement_type='redemption' and t.amount=-p.gift_amount)<>1
    or exists(select 1 from public.orders x where x.culqi_charge_id=o.culqi_charge_id and x.id<>o.id)
    or exists(select 1 from public.gift_card_purchases x where x.culqi_charge_id=o.culqi_charge_id)
    or exists(select 1 from public.gift_card_culqi_attempts x where x.order_id=o.id and x.status in ('processing','reconciliation_required')) then
    raise exception 'Refund financial relationships do not match';
  end if;
  return jsonb_build_object('order_id',o.id,'checkout_id',o.checkout_id,'order_number',o.order_number,
    'attempt_id',a.id,'culqi_order_id',o.culqi_order_id,'charge_id',o.culqi_charge_id,'amount_cents',(p.other_amount*100)::bigint,'currency','PEN','charge_since',a.created_at);
end $$;

create function public.prepare_external_refund(p_order_id uuid,p_actor uuid,p_note text,p_create boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.culqi_external_refunds; s jsonb;
begin
  if p_actor is null or not exists(select 1 from public.staff_profiles where user_id=p_actor and active and role in ('admin','manager'))
    or length(btrim(coalesce(p_note,'')))<12 or length(p_note)>1000 then raise exception 'Audited refund authorization required'; end if;
  perform 1 from public.orders where id=p_order_id for update;
  perform 1 from public.gift_card_order_payments where order_id=p_order_id for update;
  select * into r from public.culqi_external_refunds where order_id=p_order_id for update;
  if found then
    if r.state='completed' and not exists(select 1 from public.orders where id=p_order_id and status='rechazado'
      and payment_status='refunded' and external_payment_refund_status='completed') then raise exception 'Completed refund order mismatch'; end if;
    return jsonb_build_object('intent',to_jsonb(r)-'claim_token','may_submit',false);
  end if;
  if not p_create then return null; end if;
  s:=public.external_refund_snapshot(p_order_id,p_actor);
  insert into public.culqi_external_refunds(order_id,checkout_id,order_number,attempt_id,culqi_order_id,charge_id,amount_cents,currency,state,created_by,updated_by,charge_since)
    values(p_order_id,(s->>'checkout_id')::uuid,s->>'order_number',(s->>'attempt_id')::uuid,s->>'culqi_order_id',s->>'charge_id',(s->>'amount_cents')::bigint,
      'PEN','processing',p_actor,p_actor,(s->>'charge_since')::timestamptz) returning * into r;
  insert into public.culqi_external_refund_audit(intent_id,actor,event,new_state,note)
    values(r.id,p_actor,'prepared',r.state,btrim(p_note));
  return jsonb_build_object('intent',to_jsonb(r)-'claim_token','may_submit',true,'claim_token',r.claim_token);
end $$;

create function public.claim_external_refund_post(p_order_id uuid,p_intent_id uuid,p_actor uuid,p_claim_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.culqi_external_refunds; s jsonb;
begin
  perform 1 from public.orders where id=p_order_id for update;
  perform 1 from public.gift_card_order_payments where order_id=p_order_id for update;
  select * into r from public.culqi_external_refunds where id=p_intent_id and order_id=p_order_id for update;
  if r.id is null or p_claim_token is null or r.claim_token<>p_claim_token or r.post_started_at is not null
    or r.refund_id is not null or r.state<>'processing' then return false; end if;
  s:=public.external_refund_snapshot(p_order_id,p_actor);
  if s->>'charge_id'<>r.charge_id or s->>'culqi_order_id' is distinct from r.culqi_order_id or (s->>'amount_cents')::bigint<>r.amount_cents
    or (s->>'checkout_id')::uuid<>r.checkout_id or (s->>'attempt_id')::uuid<>r.attempt_id then raise exception 'Refund snapshot changed'; end if;
  update public.culqi_external_refunds set post_started_at=now(),updated_at=now(),updated_by=p_actor where id=r.id;
  insert into public.culqi_external_refund_audit(intent_id,actor,event,old_state,new_state,note)
    values(r.id,p_actor,'post_authorized',r.state,r.state,'One-shot provider POST authorized; never automatically retry.');
  return true;
end $$;

create function public.record_external_refund(p_order_id uuid,p_intent_id uuid,p_actor uuid,p_state text,p_refund_id text,
  p_amount_cents bigint,p_charge_id text,p_provider_status text,p_provider_http integer,p_safe_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.culqi_external_refunds; o public.orders; s jsonb; v_provider text:=lower(btrim(coalesce(p_provider_status,'')));
begin
  if not exists(select 1 from public.staff_profiles where user_id=p_actor and active and role in ('admin','manager')) then raise exception 'Refund operator not authorized'; end if;
  select * into o from public.orders where id=p_order_id for update;
  perform 1 from public.gift_card_order_payments where order_id=p_order_id for update;
  select * into r from public.culqi_external_refunds where id=p_intent_id and order_id=p_order_id for update;
  if r.id is null or p_state is null or p_state not in ('pending','completed','rejected','reconciliation_required')
    or p_amount_cents is distinct from r.amount_cents or p_charge_id is distinct from r.charge_id
    or r.checkout_id is distinct from o.checkout_id or r.charge_id is distinct from o.culqi_charge_id
    or (p_refund_id is not null and p_refund_id !~ ('^ref_'||split_part(r.charge_id,'_',2)||'_[A-Za-z0-9]+$'))
    or (r.refund_id is not null and r.refund_id is distinct from p_refund_id) then raise exception 'Refund evidence mismatch'; end if;
  if r.state='completed' then
    if o.status<>'rechazado' or o.payment_status<>'refunded' or o.external_payment_refund_status is distinct from 'completed' then
      raise exception 'Completed refund order mismatch'; end if;
    return to_jsonb(r)-'claim_token';
  end if;
  s:=public.external_refund_snapshot(p_order_id,p_actor);
  if s->>'charge_id'<>r.charge_id or s->>'culqi_order_id' is distinct from r.culqi_order_id or (s->>'amount_cents')::bigint<>r.amount_cents
    or (s->>'checkout_id')::uuid<>r.checkout_id or (s->>'attempt_id')::uuid<>r.attempt_id then raise exception 'Refund snapshot changed'; end if;
  if p_state in ('pending','completed') and (p_refund_id is null or p_provider_http is null or p_provider_http not in (200,201)
    or (p_state='pending' and v_provider<>'pendiente')
    or (p_state='completed' and v_provider not in ('completa','completado'))) then raise exception 'Refund not terminally verified'; end if;
  if p_state='rejected' and not coalesce((p_refund_id is not null and v_provider='rechazado' and p_provider_http in (200,201))
    or (p_refund_id is null and r.post_started_at is not null and p_provider_http between 400 and 499),false) then raise exception 'Refund rejection not verified'; end if;
  -- No duplicate audit row for the same observation; completed can never be downgraded.
  if r.state=p_state and r.refund_id is not distinct from p_refund_id and r.provider_status is not distinct from p_provider_status
    and r.provider_http is not distinct from p_provider_http and r.safe_error is not distinct from p_safe_error then return to_jsonb(r)-'claim_token'; end if;
  update public.culqi_external_refunds set state=p_state,refund_id=coalesce(r.refund_id,p_refund_id),provider_status=left(p_provider_status,40),
    provider_http=p_provider_http,safe_error=left(p_safe_error,300),updated_at=now(),updated_by=p_actor where id=r.id;
  insert into public.culqi_external_refund_audit(intent_id,actor,event,old_state,new_state,refund_id,provider_http,provider_status,note)
    values(r.id,p_actor,'observed',r.state,p_state,p_refund_id,p_provider_http,left(p_provider_status,40),coalesce(left(p_safe_error,300),'Provider refund evidence verified by backend.'));
  if p_state='completed' then
    update public.orders set external_payment_refund_status='completed',payment_status='refunded' where id=p_order_id;
  end if;
  select * into r from public.culqi_external_refunds where id=r.id;
  return to_jsonb(r)-'claim_token';
end $$;

revoke all on function public.external_refund_snapshot(uuid,uuid),public.prepare_external_refund(uuid,uuid,text,boolean),
  public.claim_external_refund_post(uuid,uuid,uuid,uuid),public.record_external_refund(uuid,uuid,uuid,text,text,bigint,text,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.external_refund_snapshot(uuid,uuid),public.prepare_external_refund(uuid,uuid,text,boolean),
  public.claim_external_refund_post(uuid,uuid,uuid,uuid),public.record_external_refund(uuid,uuid,uuid,text,text,bigint,text,text,integer,text)
  to service_role;
