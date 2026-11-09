-- STAGING / Culqi TEST only. No existing financial RPC or balance/ledger rule changes.
create table public.gift_card_precharge_resolutions (
  order_id uuid primary key references public.orders(id),
  checkout_id uuid not null unique,
  reservation_id uuid not null unique references public.gift_card_order_payments(checkout_id),
  gift_card_id uuid not null references public.gift_cards(id),
  culqi_order_id text not null unique check (culqi_order_id ~ '^ord_test_[A-Za-z0-9]+$'),
  actor uuid not null references auth.users(id),
  resolved_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason)) between 12 and 1000),
  resolution text not null default 'precharge_no_charge' check (resolution='precharge_no_charge'),
  prior_state jsonb not null,
  evidence jsonb not null
);
alter table public.gift_card_precharge_resolutions enable row level security;
revoke all on public.gift_card_precharge_resolutions from public,anon,authenticated,service_role;
grant select,insert on public.gift_card_precharge_resolutions to service_role;

create function public.resolve_precharge_gift_card_order(p_order_id uuid,p_checkout_id uuid,p_actor uuid,p_note text,p_evidence jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders; r public.gift_card_order_payments; a public.gift_card_precharge_resolutions;
begin
  -- Backend verifies bearer with Auth; RPC independently verifies the asserted human is active/authorized.
  if p_actor is null or not exists(select 1 from public.staff_profiles where user_id=p_actor and active and role in ('admin','manager'))
    or length(btrim(coalesce(p_note,''))) not between 12 and 1000 then raise exception 'Authorized human and audit note required'; end if;
  -- Same lock order as begin/complete/release. A concurrent charge attempt must wait, then reject the terminal order.
  select * into o from public.orders where id=p_order_id for update;
  select * into r from public.gift_card_order_payments where order_id=p_order_id for update;
  if o.id is null or r.order_id is null or p_checkout_id is null
    or o.checkout_id is distinct from p_checkout_id or r.checkout_id is distinct from p_checkout_id
    or o.gift_card_id is distinct from r.gift_card_id or o.gift_card_amount is distinct from r.gift_amount
    or o.other_payment_amount is distinct from r.other_amount or o.total is distinct from r.gift_amount+r.other_amount
    or r.gift_amount<=0 or r.other_amount<=0 or o.culqi_order_id is null or o.culqi_order_id !~ '^ord_test_[A-Za-z0-9]+$'
    or o.culqi_charge_id is not null or o.payment_status not in ('pending','expired') or o.status<>'nuevo'
    or exists(select 1 from public.gift_card_culqi_attempts where order_id=p_order_id or checkout_id=p_checkout_id)
    or exists(select 1 from public.gift_card_transactions where order_id=p_order_id and movement_type='redemption')
    or exists(select 1 from public.culqi_external_refunds where order_id=p_order_id or checkout_id=p_checkout_id)
    then raise exception 'Pre-charge order identity/state mismatch'; end if;
  select * into a from public.gift_card_precharge_resolutions where order_id=p_order_id;
  if a.order_id is not null then
    if a.checkout_id=p_checkout_id and a.gift_card_id=r.gift_card_id and a.culqi_order_id=o.culqi_order_id
      and r.status='released' and r.payment_state='released' and o.payment_status='expired'
      then return jsonb_build_object('resolved',true,'idempotent',true,'resolution','precharge_no_charge'); end if;
    raise exception 'Prior resolution inconsistent';
  end if;
  if r.status<>'reserved' or r.payment_state<>'payment_pending' or o.payment_status<>'pending' then raise exception 'Reservation not eligible'; end if;
  -- Service-role only evidence, freshly produced by the backend's read-only provider verification.
  if jsonb_typeof(p_evidence) is distinct from 'object'
    or p_evidence-array['order_id','order_number','state','currency','amount','associated_charges','approved_charges','charge_scan_complete','order_http','checked_at'] is distinct from '{}'::jsonb
    or p_evidence->>'order_id' is distinct from o.culqi_order_id or p_evidence->>'order_number' is distinct from o.order_number
    or p_evidence->>'state' is distinct from 'deleted' or p_evidence->>'currency' is distinct from 'PEN'
    or (p_evidence->>'amount')::numeric is distinct from round(r.other_amount*100)
    or p_evidence->'associated_charges' is distinct from '0'::jsonb or p_evidence->'approved_charges' is distinct from '0'::jsonb
    or p_evidence->'charge_scan_complete' is distinct from 'true'::jsonb or p_evidence->'order_http' is distinct from '200'::jsonb
    or p_evidence->>'checked_at' is null or (p_evidence->>'checked_at')::timestamptz<clock_timestamp()-interval '2 minutes'
    or (p_evidence->>'checked_at')::timestamptz>clock_timestamp()+interval '5 seconds'
    then raise exception 'Verified zero-charge terminal evidence required'; end if;
  insert into public.gift_card_precharge_resolutions(order_id,checkout_id,reservation_id,gift_card_id,culqi_order_id,actor,reason,prior_state,evidence)
    values(o.id,p_checkout_id,r.checkout_id,r.gift_card_id,o.culqi_order_id,p_actor,btrim(p_note),
      jsonb_build_object('order_status',o.status,'payment_status',o.payment_status,'reservation_status',r.status,'payment_state',r.payment_state,'gift_amount',r.gift_amount,'other_amount',r.other_amount),p_evidence);
  update public.orders set payment_status='expired' where id=o.id;
  update public.gift_card_order_payments set payment_state='expired' where order_id=o.id;
  if public.release_gift_card_order_reservation(o.id) is distinct from true then raise exception 'Release not confirmed'; end if;
  return jsonb_build_object('resolved',true,'idempotent',false,'resolution','precharge_no_charge');
end $$;
revoke all on function public.resolve_precharge_gift_card_order(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.resolve_precharge_gift_card_order(uuid,uuid,uuid,text,jsonb) to service_role;
