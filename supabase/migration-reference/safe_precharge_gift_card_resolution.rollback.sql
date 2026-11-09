-- Reference only. NOT automatically executed. Disable/remove Function first.
-- Retain table and resolved financial state; never recreate a released reservation.
revoke execute on function public.resolve_precharge_gift_card_order(uuid,uuid,uuid,text,jsonb) from service_role;
-- Optional only after reviewing dependencies and ensuring no callers remain:
-- drop function public.resolve_precharge_gift_card_order(uuid,uuid,uuid,text,jsonb);
-- Never drop gift_card_precharge_resolutions when audit rows exist.
