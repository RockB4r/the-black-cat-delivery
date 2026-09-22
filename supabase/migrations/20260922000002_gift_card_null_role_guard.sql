-- NULL is not rejected by `role NOT IN (...)`; explicitly coalesce it.
create or replace function public.create_gift_card(
  p_amount numeric, p_purchaser_name text, p_recipient_name text default null,
  p_recipient_email text default null, p_recipient_phone text default null,
  p_message text default null, p_transferable boolean default true
) returns public.gift_cards language plpgsql security definer set search_path = '' as $$
declare v_card public.gift_cards; v_role text;
begin
  v_role := private.gift_card_staff_role();
  if coalesce(v_role, '') not in ('manager','admin') then raise exception 'No autorizado'; end if;
  if p_amount is null or p_amount <> round(p_amount, 2) or not (p_amount in (50,75,100,200) or p_amount > 100) or p_amount > 999999 then raise exception 'Monto no permitido'; end if;
  if nullif(btrim(p_purchaser_name), '') is null or length(btrim(p_purchaser_name)) > 160 then raise exception 'Comprador obligatorio'; end if;
  if not coalesce(p_transferable, true) and nullif(btrim(p_recipient_name), '') is null then raise exception 'Beneficiario obligatorio'; end if;
  if length(coalesce(p_recipient_name,'')) > 160 or length(coalesce(p_recipient_email,'')) > 254 or length(coalesce(p_recipient_phone,'')) > 40 or length(coalesce(p_message,'')) > 1000 then raise exception 'Datos demasiado largos'; end if;
  insert into public.gift_cards (
    code, initial_balance, current_balance, status, purchaser_name, recipient_name, recipient_email,
    recipient_phone, gift_message, transferable, activated_at, expires_at, created_by
  ) values (
    'BC-GC-' || lpad(nextval('public.gift_card_code_seq')::text, 6, '0'),
    p_amount, p_amount, 'active', btrim(p_purchaser_name), nullif(btrim(p_recipient_name), ''),
    nullif(btrim(p_recipient_email), ''), nullif(btrim(p_recipient_phone), ''),
    nullif(btrim(p_message), ''), coalesce(p_transferable, true), now(), now() + interval '45 days', auth.uid()
  ) returning * into v_card;
  insert into public.gift_card_transactions(gift_card_id, movement_type, amount, balance_before, balance_after, performed_by)
    values (v_card.id, 'creation', p_amount, 0, p_amount, auth.uid());
  return v_card;
end $$;

create or replace function public.block_gift_card(p_card_id uuid)
returns public.gift_cards language plpgsql security definer set search_path = '' as $$
declare v_card public.gift_cards;
begin
  if coalesce(private.gift_card_staff_role(), '') not in ('manager','admin') then raise exception 'No autorizado'; end if;
  select * into v_card from public.gift_cards where id = p_card_id for update;
  if not found or v_card.status <> 'active' or v_card.expires_at <= now() then raise exception 'Solo se puede bloquear una Gift Card activa'; end if;
  update public.gift_cards set status = 'blocked', blocked_at = now(), blocked_by = auth.uid() where id = p_card_id returning * into v_card;
  insert into public.gift_card_transactions(gift_card_id, movement_type, amount, balance_before, balance_after, performed_by)
    values (p_card_id, 'block', 0, v_card.current_balance, v_card.current_balance, auth.uid());
  return v_card;
end $$;
