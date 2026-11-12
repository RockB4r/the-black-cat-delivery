-- STAGING ONLY / TEST ONLY. Dedicated recovery of culqi_body_rejected classification bug.
-- Does not replace or broaden complete_mixed_culqi_attempt or any financial RPC.
create table public.gift_card_authorized_resolutions (
  attempt_id uuid primary key references public.gift_card_culqi_attempts(id),
  order_id uuid not null unique references public.orders(id),
  checkout_id uuid not null unique references public.gift_card_order_payments(checkout_id),
  gift_card_id uuid not null references public.gift_cards(id),
  culqi_order_id text not null unique check (culqi_order_id ~ '^ord_test_[A-Za-z0-9]+$'),
  charge_id text not null unique check (charge_id ~ '^chr_test_[A-Za-z0-9]+$'),
  redemption_id uuid not null unique references public.gift_card_transactions(id),
  actor uuid not null references auth.users(id),
  resolved_at timestamptz not null default now(),
  resolution text not null default 'external_authorized_reconciliation' check(resolution='external_authorized_reconciliation'),
  prior_state jsonb not null,
  evidence jsonb not null
);
alter table public.gift_card_authorized_resolutions enable row level security;
revoke all on public.gift_card_authorized_resolutions from public,anon,authenticated,service_role;
grant select,insert on public.gift_card_authorized_resolutions to service_role;

create function public.reconcile_externally_authorized_mixed_attempt(
  p_attempt_id uuid,p_checkout_id uuid,p_charge_id text,p_actor uuid,p_evidence jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders; r public.gift_card_order_payments; a public.gift_card_culqi_attempts;
  g public.gift_cards; prior public.gift_card_authorized_resolutions; ledger public.gift_card_transactions;
  oid uuid; reserved numeric; snapshot jsonb; result jsonb;
begin
  if p_actor is null or not exists(select 1 from public.staff_profiles where user_id=p_actor and active and role in ('admin','manager'))
    then raise exception 'Active authorized human required'; end if;
  select order_id into oid from public.gift_card_culqi_attempts where id=p_attempt_id;
  -- Lock order shared with existing begin/complete/apply paths. Re-read identity under locks.
  select * into o from public.orders where id=oid for update;
  select * into r from public.gift_card_order_payments where order_id=oid for update;
  select * into a from public.gift_card_culqi_attempts where id=p_attempt_id for update;
  select * into g from public.gift_cards where id=r.gift_card_id for update;
  if o.id is null or r.order_id is null or a.id is null or g.id is null or p_checkout_id is null or p_charge_id is null
    or p_charge_id !~ '^chr_test_[A-Za-z0-9]+$' or o.culqi_order_id !~ '^ord_test_[A-Za-z0-9]+$' or o.culqi_order_id is null
    or a.order_id is distinct from o.id or a.checkout_id is distinct from p_checkout_id or r.checkout_id is distinct from p_checkout_id
    or o.checkout_id is distinct from p_checkout_id or a.culqi_order_id is distinct from o.culqi_order_id
    or o.gift_card_id is distinct from g.id or a.gift_amount is distinct from r.gift_amount or a.culqi_amount is distinct from r.other_amount
    or r.gift_amount is distinct from 40::numeric or r.other_amount is distinct from 10::numeric
    or o.gift_card_amount is distinct from r.gift_amount or o.other_payment_amount is distinct from r.other_amount or o.total is distinct from 50::numeric
    or o.payment_method is distinct from 'gift_card_culqi' or o.other_payment_method is distinct from 'culqi'
    or (o.culqi_charge_id is not null and o.culqi_charge_id<>p_charge_id) or (a.culqi_charge_id is not null and a.culqi_charge_id<>p_charge_id)
    then raise exception 'Authorized reconciliation identity/split mismatch'; end if;
  -- Backend-only attestation: fresh GET + classifier + exhaustive charge/refund scans. No client evidence accepted.
  if jsonb_typeof(p_evidence) is distinct from 'object'
    or p_evidence-array['charge_id','order_id','order_number','checkout_id','attempt_id','amount','currency','capture','outcome_type','outcome_code',
      'authorization_present','decline_absent','classification','associated_charges','approved_charges','refunds','charge_scan_complete','refund_scan_complete','charge_http','checked_at'] is distinct from '{}'::jsonb
    or p_evidence->>'charge_id' is distinct from p_charge_id or p_evidence->>'order_id' is distinct from o.culqi_order_id
    or p_evidence->>'order_number' is distinct from o.order_number or p_evidence->>'checkout_id' is distinct from p_checkout_id::text
    or p_evidence->>'attempt_id' is distinct from p_attempt_id::text or p_evidence->'amount' is distinct from '1000'::jsonb
    or p_evidence->>'currency' is distinct from 'PEN' or p_evidence->'capture' is distinct from 'true'::jsonb
    or p_evidence->>'outcome_type' is distinct from 'venta_exitosa' or p_evidence->>'outcome_code' is distinct from 'AUT0000'
    or p_evidence->'authorization_present' is distinct from 'true'::jsonb or p_evidence->'decline_absent' is distinct from 'true'::jsonb
    or p_evidence->>'classification' is distinct from 'approved' or p_evidence->'associated_charges' is distinct from '1'::jsonb
    or p_evidence->'approved_charges' is distinct from '1'::jsonb or p_evidence->'refunds' is distinct from '0'::jsonb
    or p_evidence->'charge_scan_complete' is distinct from 'true'::jsonb or p_evidence->'refund_scan_complete' is distinct from 'true'::jsonb
    or p_evidence->'charge_http' is distinct from '200'::jsonb or p_evidence->>'checked_at' is null
    or (p_evidence->>'checked_at')::timestamptz<clock_timestamp()-interval '2 minutes'
    or (p_evidence->>'checked_at')::timestamptz>clock_timestamp()+interval '5 seconds'
    then raise exception 'Fresh complete captured authorization evidence required'; end if;
  if exists(select 1 from public.culqi_external_refunds where order_id=o.id or checkout_id=p_checkout_id or charge_id=p_charge_id)
    or exists(select 1 from public.gift_card_precharge_resolutions where order_id=o.id or checkout_id=p_checkout_id)
    or exists(select 1 from public.orders where id<>o.id and culqi_charge_id=p_charge_id)
    or exists(select 1 from public.gift_card_purchases where culqi_charge_id=p_charge_id)
    or exists(select 1 from public.gift_card_culqi_attempts where id<>a.id and (culqi_charge_id=p_charge_id or order_id=o.id or checkout_id=p_checkout_id))
    then raise exception 'Refund, competing attempt or prior incompatible resolution'; end if;
  select * into prior from public.gift_card_authorized_resolutions where attempt_id=p_attempt_id;
  select * into ledger from public.gift_card_transactions where order_id=o.id and movement_type='redemption';
  select coalesce(sum(gift_amount),0) into reserved from public.gift_card_order_payments where gift_card_id=g.id and status='reserved';
  if prior.attempt_id is not null then
    if prior.order_id=o.id and prior.checkout_id=p_checkout_id and prior.gift_card_id=g.id and prior.charge_id=p_charge_id
      and prior.culqi_order_id=o.culqi_order_id and prior.redemption_id=ledger.id
      and a.status='approved' and a.resolution_source='external_authorized_reconciliation' and a.resolved_at=prior.resolved_at and a.resolved_by=prior.actor
      and a.culqi_charge_id=p_charge_id and o.culqi_charge_id=p_charge_id and o.payment_status='paid'
      and o.status=prior.prior_state->>'order_status'
      and r.status='applied' and r.payment_state='applied' and r.culqi_reference=p_charge_id
      and g.current_balance=0 and g.status='exhausted' and reserved=0
      and ledger.amount=-40 and ledger.balance_before=40 and ledger.balance_after=0 and ledger.gift_card_id=g.id
      and ledger.consumption_channel='online' and ledger.source_reference='online_order:'||o.id::text
      and (select count(*) from public.gift_card_transactions where order_id=o.id and movement_type='redemption')=1
      then return jsonb_build_object('resolved',true,'idempotent',true,'resolution','external_authorized_reconciliation'); end if;
    raise exception 'Prior authorized resolution inconsistent; no partial repair';
  end if;
  if a.status is distinct from 'rejected' or a.resolution_source is distinct from 'culqi_body_rejected'
    or a.three_ds_phase is distinct from 'authenticated_request_sent'
    or r.status is distinct from 'reserved' or r.payment_state is distinct from 'failed'
    or o.payment_status is distinct from 'pending' or o.status is distinct from 'nuevo'
    or g.status is distinct from 'active' or g.current_balance is distinct from 40::numeric or reserved<>40 or g.expires_at<=now()
    or (select count(*) from public.gift_card_order_payments where gift_card_id=g.id and status='reserved')<>1
    or exists(select 1 from public.gift_card_transactions where order_id=o.id)
    then raise exception 'Known classification bug/reservation state required'; end if;
  snapshot:=jsonb_build_object('attempt_status',a.status,'resolution_source',a.resolution_source,'resolved_at',a.resolved_at,
    'resolved_by',a.resolved_by,'resolution_note',a.resolution_note,'phase',a.three_ds_phase,'order_status',o.status,
    'payment_status',o.payment_status,'reservation_status',r.status,'payment_state',r.payment_state,'balance',g.current_balance,'reserved',reserved);
  update public.orders set culqi_charge_id=p_charge_id where id=o.id;
  -- Reuse the existing financial implementation; do not fake an active attempt or bypass its normal completion guard.
  result:=public.apply_gift_card_to_order(o.id,p_charge_id);
  select * into ledger from public.gift_card_transactions where order_id=o.id and movement_type='redemption';
  if result->'idempotent' is distinct from 'false'::jsonb or ledger.id is null or ledger.amount<>-40
    or ledger.balance_before<>40 or ledger.balance_after<>0 or ledger.consumption_channel<>'online'
    or ledger.gift_card_id<>g.id or ledger.source_reference is distinct from 'online_order:'||o.id::text
    or (select count(*) from public.gift_card_transactions where order_id=o.id and movement_type='redemption')<>1
    or not exists(select 1 from public.gift_cards where id=g.id and current_balance=0 and status='exhausted')
    or not exists(select 1 from public.gift_card_order_payments where checkout_id=p_checkout_id and status='applied' and payment_state='applied' and culqi_reference=p_charge_id)
    or not exists(select 1 from public.orders where id=o.id and payment_status='paid' and status=o.status)
    then raise exception 'Atomic financial application not confirmed'; end if;
  update public.gift_card_culqi_attempts set status='approved',culqi_charge_id=p_charge_id,resolved_at=now(),resolved_by=p_actor,
    resolution_source='external_authorized_reconciliation',resolution_note='Known culqi_body_rejected classification corrected after fresh TEST provider verification'
    where id=a.id;
  insert into public.gift_card_authorized_resolutions(attempt_id,order_id,checkout_id,gift_card_id,culqi_order_id,charge_id,redemption_id,actor,prior_state,evidence)
    values(a.id,o.id,p_checkout_id,g.id,o.culqi_order_id,p_charge_id,ledger.id,p_actor,snapshot,p_evidence);
  return jsonb_build_object('resolved',true,'idempotent',false,'resolution','external_authorized_reconciliation');
end $$;
revoke all on function public.reconcile_externally_authorized_mixed_attempt(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reconcile_externally_authorized_mixed_attempt(uuid,uuid,text,uuid,jsonb) to service_role;
