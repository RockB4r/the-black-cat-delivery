-- A blocked Gift Card can be reactivated only by an active manager/admin,
-- while it still has a positive balance and has not expired.
alter table public.gift_card_transactions
  drop constraint gift_card_transactions_movement_type_check;
alter table public.gift_card_transactions
  add constraint gift_card_transactions_movement_type_check
  check (movement_type in ('creation', 'redemption', 'block', 'unblock'));

create function public.unblock_gift_card(p_card_id uuid)
returns public.gift_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.gift_cards;
begin
  if coalesce(private.gift_card_staff_role(), '') not in ('manager', 'admin') then
    raise exception 'No autorizado';
  end if;

  select * into v_card
  from public.gift_cards
  where id = p_card_id
  for update;

  if not found or v_card.status <> 'blocked' then
    raise exception 'Solo se puede desbloquear una Gift Card bloqueada';
  end if;
  if v_card.current_balance <= 0 then
    raise exception 'No se puede desbloquear una Gift Card sin saldo';
  end if;
  if v_card.expires_at is null or v_card.expires_at <= now() then
    raise exception 'No se puede desbloquear una Gift Card vencida';
  end if;

  update public.gift_cards
  set status = 'active', blocked_at = null, blocked_by = null
  where id = p_card_id
  returning * into v_card;

  insert into public.gift_card_transactions
    (gift_card_id, movement_type, amount, balance_before, balance_after, performed_by)
  values
    (p_card_id, 'unblock', 0, v_card.current_balance, v_card.current_balance, auth.uid());

  return v_card;
end $$;

revoke all on function public.unblock_gift_card(uuid) from public, anon;
grant execute on function public.unblock_gift_card(uuid) to authenticated;
