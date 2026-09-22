-- Internal gift cards. No public/client access; all mutations go through authenticated RPCs.
create schema if not exists private;
create sequence if not exists public.gift_card_code_seq;
revoke all on sequence public.gift_card_code_seq from public, anon, authenticated;

create table public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  qr_token text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  initial_balance numeric(12,2) not null check (initial_balance > 0),
  current_balance numeric(12,2) not null check (current_balance >= 0 and current_balance <= initial_balance),
  status text not null default 'pending' check (status in ('pending','active','exhausted','expired','blocked')),
  purchaser_name text not null,
  recipient_name text,
  recipient_email text,
  recipient_phone text,
  gift_message text,
  transferable boolean not null default true,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  expires_at timestamptz,
  created_by uuid references auth.users(id),
  blocked_at timestamptz,
  blocked_by uuid references auth.users(id),
  constraint gift_card_nontransferable_recipient check (transferable or nullif(btrim(recipient_name), '') is not null),
  constraint gift_card_activation_dates check ((status = 'pending' and activated_at is null and expires_at is null) or (status <> 'pending' and activated_at is not null and expires_at is not null))
);

create table public.gift_card_transactions (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references public.gift_cards(id),
  movement_type text not null check (movement_type in ('creation','redemption','block')),
  amount numeric(12,2) not null,
  balance_before numeric(12,2) not null check (balance_before >= 0),
  balance_after numeric(12,2) not null check (balance_after >= 0),
  reference text,
  performed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint gift_card_transaction_math check (balance_after = balance_before + amount)
);
create unique index gift_card_redemption_reference_unique on public.gift_card_transactions(gift_card_id, reference)
  where movement_type = 'redemption' and reference is not null;
create index gift_cards_created_at_idx on public.gift_cards(created_at desc);
create index gift_card_transactions_card_idx on public.gift_card_transactions(gift_card_id, created_at desc);

create or replace function private.gift_card_transaction_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'El historial de Gift Cards es inmutable';
end $$;
create trigger gift_card_transactions_immutable before update or delete on public.gift_card_transactions
  for each row execute function private.gift_card_transaction_immutable();

alter table public.gift_cards enable row level security;
alter table public.gift_card_transactions enable row level security;
revoke all on public.gift_cards, public.gift_card_transactions from public, anon, authenticated;
grant select on public.gift_cards, public.gift_card_transactions to authenticated;

create or replace function private.gift_card_staff_role()
returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.staff_profiles p where p.user_id = auth.uid() and p.active = true and p.role in ('staff','manager','admin') limit 1
$$;
revoke all on function private.gift_card_staff_role() from public, anon, authenticated;

create policy gift_cards_staff_read on public.gift_cards for select to authenticated
  using (private.gift_card_staff_role() is not null);
create policy gift_card_transactions_staff_read on public.gift_card_transactions for select to authenticated
  using (private.gift_card_staff_role() is not null);

create or replace function public.create_gift_card(
  p_amount numeric, p_purchaser_name text, p_recipient_name text default null,
  p_recipient_email text default null, p_recipient_phone text default null,
  p_message text default null, p_transferable boolean default true
) returns public.gift_cards language plpgsql security definer set search_path = '' as $$
declare v_card public.gift_cards; v_role text;
begin
  v_role := private.gift_card_staff_role();
  if v_role not in ('manager','admin') then raise exception 'No autorizado'; end if;
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

create or replace function public.redeem_gift_card(
  p_card_id uuid, p_consumption_amount numeric, p_reference text, p_recipient_name text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_card public.gift_cards; v_debit numeric(12,2); v_prior public.gift_card_transactions;
begin
  if private.gift_card_staff_role() is null then raise exception 'No autorizado'; end if;
  if p_consumption_amount is null or p_consumption_amount <= 0 or p_consumption_amount <> round(p_consumption_amount, 2) or p_consumption_amount > 999999 then raise exception 'Monto inválido'; end if;
  if nullif(btrim(p_reference), '') is null or length(p_reference) > 120 then raise exception 'Referencia obligatoria'; end if;
  select * into v_card from public.gift_cards where id = p_card_id for update;
  if not found then raise exception 'Gift Card no encontrada'; end if;
  select * into v_prior from public.gift_card_transactions where gift_card_id = p_card_id and movement_type = 'redemption' and reference = p_reference;
  if found then return jsonb_build_object('debited', -v_prior.amount, 'remaining_to_pay', greatest(p_consumption_amount + v_prior.amount, 0), 'balance', v_prior.balance_after, 'idempotent', true); end if;
  if v_card.status <> 'active' or v_card.expires_at <= now() or v_card.current_balance <= 0 then raise exception 'Gift Card no disponible'; end if;
  if not v_card.transferable and lower(btrim(coalesce(p_recipient_name,''))) <> lower(btrim(v_card.recipient_name)) then raise exception 'Verifica identidad del beneficiario'; end if;
  v_debit := least(v_card.current_balance, p_consumption_amount);
  update public.gift_cards set current_balance = current_balance - v_debit,
    status = case when current_balance - v_debit = 0 then 'exhausted' else 'active' end where id = p_card_id;
  insert into public.gift_card_transactions(gift_card_id, movement_type, amount, balance_before, balance_after, reference, performed_by)
    values (p_card_id, 'redemption', -v_debit, v_card.current_balance, v_card.current_balance - v_debit, p_reference, auth.uid());
  return jsonb_build_object('debited', v_debit, 'remaining_to_pay', p_consumption_amount - v_debit, 'balance', v_card.current_balance - v_debit, 'idempotent', false);
end $$;

create or replace function public.block_gift_card(p_card_id uuid)
returns public.gift_cards language plpgsql security definer set search_path = '' as $$
declare v_card public.gift_cards;
begin
  if private.gift_card_staff_role() not in ('manager','admin') then raise exception 'No autorizado'; end if;
  select * into v_card from public.gift_cards where id = p_card_id for update;
  if not found or v_card.status <> 'active' or v_card.expires_at <= now() then raise exception 'Solo se puede bloquear una Gift Card activa'; end if;
  update public.gift_cards set status = 'blocked', blocked_at = now(), blocked_by = auth.uid() where id = p_card_id returning * into v_card;
  insert into public.gift_card_transactions(gift_card_id, movement_type, amount, balance_before, balance_after, performed_by)
    values (p_card_id, 'block', 0, v_card.current_balance, v_card.current_balance, auth.uid());
  return v_card;
end $$;

revoke all on function public.create_gift_card(numeric,text,text,text,text,text,boolean) from public, anon;
revoke all on function public.redeem_gift_card(uuid,numeric,text,text) from public, anon;
revoke all on function public.block_gift_card(uuid) from public, anon;
grant execute on function public.create_gift_card(numeric,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.redeem_gift_card(uuid,numeric,text,text) to authenticated;
grant execute on function public.block_gift_card(uuid) to authenticated;
