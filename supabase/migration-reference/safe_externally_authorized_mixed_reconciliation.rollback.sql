-- STAGING ONLY. Run only after withdrawing the new Function and verifying no in-flight invocation.
-- Never reverse a financial application by deleting audit/ledger records.
begin;
lock table public.gift_card_authorized_resolutions in access exclusive mode;
do $$ begin
  if exists(select 1 from public.gift_card_authorized_resolutions) then
    raise exception 'Resolution history exists: preserve financial/audit records; automatic rollback forbidden';
  end if;
end $$;
drop function public.reconcile_externally_authorized_mixed_attempt(uuid,uuid,text,uuid,jsonb);
drop table public.gift_card_authorized_resolutions;
commit;
