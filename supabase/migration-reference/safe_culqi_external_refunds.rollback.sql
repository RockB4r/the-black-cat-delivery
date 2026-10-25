-- Reference only. Do not execute without separate authorization in the target environment.
-- Remove/disable the new Function first. Preserve all refund intents, evidence and order states.
-- No DROP, DELETE, balance changes, reservation changes or reversal of a completed refund.
begin;
revoke execute on function public.external_refund_snapshot(uuid,uuid),
  public.prepare_external_refund(uuid,uuid,text,boolean),
  public.claim_external_refund_post(uuid,uuid,uuid,uuid),
  public.record_external_refund(uuid,uuid,uuid,text,text,bigint,text,text,integer,text)
  from service_role;
commit;
