# Suspension rollback (manual, never automatic)

Do not roll back this protection to recover webhook/reconciliation: those paths have no gate.
Prefer keeping the additive settings/audit/guards and reverting only the new UI if needed.
Never restore the production dump over live payments, delete reservations or financial movements.

Before undoing: stop new Gift Card traffic, retain audit, confirm no operation is in flight,
deploy compatible Functions without these admission checks only under explicit approval.
Removing guards reopens admission regardless of flags; it is NOT a safe incident switch.

Exact optional DDL rollback, only after those prerequisites and a separate authorization:

```sql
begin;
drop trigger gift_card_purchase_admission on public.gift_card_purchases;
drop trigger gift_card_reservation_admission on public.gift_card_order_payments;
drop trigger gift_card_mixed_attempt_admission on public.gift_card_culqi_attempts;
drop trigger gift_card_manual_redemption_admission on public.gift_card_transactions;
drop function private.gift_card_entry_guard();
drop function public.set_gift_card_operation(text,boolean);
drop policy gift_card_operation_settings_admin_update on public.app_settings;
drop policy gift_card_operation_settings_admin_read on public.app_settings;
drop trigger app_settings_gift_card_operations_audit on public.app_settings;
drop function private.audit_gift_card_operations();
alter table public.app_settings drop constraint app_settings_gift_card_operations_shape;
commit;
```

Retain the settings row, public.gift_card_operation_audit and its SELECT policy/RLS.
Do NOT drop audit or delete its actor/timestamp/old/new values. No original RPC was replaced,
so no function-body restoration is required. No Gift Card balance/payment data changes in
this migration. The historical audit cannot be reconstructed after deletion.
