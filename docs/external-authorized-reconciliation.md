# Checkpoint 21M — staging-only authorized-charge recovery

This operation is separate from normal completion, no-charge resolution, pre-charge release and refunds. It does not broaden `complete_mixed_culqi_attempt` and cannot call a Culqi charge/refund POST or DELETE.

## Entry point and trust boundary

`POST /.netlify/functions/gift-card-reconcile-authorized` accepts only `attempt_id`, `checkout_id`, `charge_id`. Auth verifies the bearer with Supabase and requires an active Admin/Manager. Actor, amounts, evidence and status cannot be supplied by the client. Hard guards require Supabase `kqfphrukxdvlrbjipjnx` and Culqi TEST. No environment variable changes are needed.

The backend GETs the exact charge and order, uses the 21K classifier and additionally requires captured `venta_exitosa/AUT0000`, authorization present, no decline and exact checkout/attempt metadata. It exhausts charge and refund pagination without an amount/time filter (10 pages of 100 maximum, otherwise fail closed). Exactly one linked charge must match; no linked refund may exist. Unknown/malformed/pagination/error evidence denies the operation before RPC. `paid=false` alone never authorizes. Only a bounded, non-secret attestation is persisted; no raw authorization code, token, fingerprint, card data or provider payload.

## Transaction

`reconcile_externally_authorized_mixed_attempt(uuid,uuid,text,uuid,jsonb)` is SECURITY INVOKER, empty search_path, service_role-only. The asserted human is independently checked against active staff. Evidence must be fresh (2 minutes), complete and exact. Locks are order → reservation → attempt → Gift Card, consistent with existing financial paths.

This narrow recovery requires the known `rejected/culqi_body_rejected` bug, authenticated_request_sent phase, reserved/failed payment, an unpaid nuevo order, 50=40+10, an active card with balance 40 and exactly one reserved 40, no prior ledger for the order, no refund, no competing attempt/charge owner or incompatible pre-charge resolution. It deliberately does not handle arbitrary rejected attempts or other amounts.

The existing `apply_gift_card_to_order` performs the debit/ledger/application. The same transaction updates the existing attempt, attaches the existing charge, preserves kitchen status and inserts `gift_card_authorized_resolutions`. There is no temporary processing state or synthetic attempt. Any failure, including the final audit INSERT, rolls back all writes.

Audit includes actor/time, prior status/source/note/time, all identities, unique redemption and fresh provider attestation. The table has RLS and no public policies; anon/authenticated have no access. service_role has SELECT/INSERT only, no UPDATE/DELETE/TRUNCATE. Unique attempt/order/checkout/charge/reservation identity and ledger reference prevent duplicate resolution. Idempotent replay requires the exact already-completed state and matching ledger/audit; partial/divergent state is rejected without repair. Evidence is freshly checked even on replay. Cache synchronization follows the DB commit; `cacheSyncPending=true` reports cache failure without retrying financial writes.

## Deployment and execution

Migration `20261111235140_safe_externally_authorized_mixed_reconciliation.sql` is for staging only, never an instruction to apply production migrations. Deploy the new Function to staging before any real-case invocation. This checkpoint does not authorize resolving the existing TEST case, issuing another charge, refund or creating a checkout. No one-shot real-case execution is included.

For the existing case, a later authorized successful invocation would consume 40 once, create one online redemption -40, apply the reservation, approve the same attempt, attach the existing S/10 charge, mark payment paid, exhaust the card and create one audit. No order, attempt or provider charge is created. Expected card balance/reserved/available: 0/0/0.

Validation: actual handler tests with mocked HTTP, SQL transactional fixtures/ROLLBACK, injected failure before audit INSERT, ACL and replay/negative checks, and two independent sessions on an isolated native PostgreSQL 18 cluster. The concurrency harness lives outside the repository in `work/checkpoint21m-local-sql.mjs`; it has no cloud credentials and removes its synthetic cluster after use.

Validated on 2026-11-11 (Lima): 28 new JS tests, 285 total JS tests, 27 new SQL scenarios in both local PostgreSQL 18 and staging with ROLLBACK, existing mixed-attempt/3DS/precharge/refund SQL regression (158 refund assertions), lint, build and scoped backend typecheck PASS. Physical two-session concurrency observed a PostgreSQL lock wait: one effective application, one idempotent return, one audit, one redemption. Local temporary clusters were removed. The only build warning is the existing >500 kB bundle. The new RLS/no-policy INFO is intentional for the backend-only table; no additional security warning was introduced.

Applied ONLY to staging using MCP migration version **20261112000047**, name `safe_externally_authorized_mixed_reconciliation`. The source filename timestamp is **20261111235140**; the MCP records application time, so do not reapply the source because these timestamps differ. The actual checkout/attempt remains unchanged; audit rows and synthetic fixtures remain zero. Function publication and real-case execution remain pending separate authorization.

Rollback: stop invoking/unpublish only this new Function. Before any resolution, the guarded rollback SQL can remove the additive objects. After a resolution exists, retain financial/audit records and do not drop or reverse them automatically; a separate reviewed corrective procedure would be required. Existing financial RPCs were not changed.
