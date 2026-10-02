# Rollback: mixed Culqi attempt protection

Only roll back after disabling new mixed payments and reconciling every `processing` or `reconciliation_required` attempt. Never remove the release guard while an uncertain Culqi charge may exist.

1. Record a staging snapshot of `gift_card_culqi_attempts`, `gift_card_order_payments`, `orders`, and `gift_card_transactions`.
2. Revert the Netlify Functions deployment to the previous staging commit.
3. Restore `release_gift_card_order_reservation(uuid)` from `20260922000007_gift_cards_phase2_b_rpcs.sql` only after there are no unresolved attempts.
4. Revoke and drop the four new RPCs, then drop `gift_card_culqi_attempts` and its indexes.

Dropping the attempt table permanently removes the attempt-level audit (timestamps, actor and decision). Keep an export or snapshot before doing so. A Culqi charge, confirmed Gift Card redemption, or sent notification cannot be reversed by this SQL rollback; reconcile and refund through the existing operational process instead.
