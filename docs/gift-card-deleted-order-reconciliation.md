# Checkpoint 16: manual no-charge reconciliation fix (staging only)

## Scope / disposition

Validated on branch `gift-cards-phase2-staging`, Supabase `kqfphrukxdvlrbjipjnx`.
No production queries, mutations, migrations, Culqi requests, deploys, commits or pushes
were made during implementation/validation of this fix. The live reservation was not touched.
Backend handlers were exercised locally with mocked provider/storage/auth I/O; the actual
RPC was exercised on Supabase staging. No Netlify Function deployment was performed.

## Before / after

- Before: manual `no_charge` accepted only external order `expired`; the RPC rejected an
  attempt already marked `rejected`.
- After: manual reconciliation permits matching `expired` OR `deleted` orders, but only
  after independently checking charge evidence, DB history, order/reservation/split/checkout
  consistency and an authenticated active Admin/Manager.
- The RPC permits `processing`, `reconciliation_required`, or `rejected`, never `approved`.
  It checks identities and amounts again under the existing order/reservation/attempt locks,
  rejects prior redemption, paid/linked-charge orders and competing unresolved/approved attempts.
- Successful resolution is atomic: attempt `cleared_no_charge`, payment reservation
  `released/released`, order payment status `expired`; balance remains unchanged.
- Previous attempt status/source are retained in `resolution_note`, alongside the operator's
  justification. Existing `resolved_by`, `resolved_at`, checkout/order/attempt relationships
  provide audit linkage. No ledger movement/redemption is generated.
- Repeat resolution returns safely without another release or audit mutation. The handler
  skips the RPC on an already-consistent cleared/released/expired result.
- `expiredCulqiOrder`, automatic cleanup, webhook, charge creation, admission flags,
  permissions and historical movements are unchanged.

## Independent provider evidence (manual path only)

`culqi-no-charge.ts` verifies the exact terminal order ID, number, PEN, cents and optional
metadata. It lists all same-amount charges from five minutes before reservation admission
through the verification time, with bounded pagination. Relevant charges must have matching
identity/metadata and explicit `paid=false` plus `outcome.type=operacion_denegada`.
Any approval, unknown outcome, mismatch, unidentified charge, HTTP/network/JSON error or
incomplete pagination fails closed. Unrelated identified merchant sales are not treated as
payments of this checkout. A populated `paid_at` is neither approval evidence nor sufficient
proof of non-payment; the charge checks remain mandatory. Admin confirmation is still required.

## Migration / rollback

- File: `supabase/migrations/20261019023152_gift_card_deleted_order_reconciliation.sql`.
- SHA-256: `7440535EFEF55126ABE7BFBAB74BF1BFD5B4D836520AEAAF9D19D1490AA4C666`.
- Applied ONCE, staging only. MCP history allocated version `20261019023626` with name
  `gift_card_deleted_order_reconciliation`; this maps to the local CLI-created file above.
  The file matches the SQL applied to staging. No prior migration was edited.
- Only replaces `public.clear_mixed_culqi_attempt(uuid,uuid,uuid,text)`; no table, column,
  trigger, constraint, policy or grant changes. Owner `postgres`, SECURITY INVOKER,
  `search_path=''`, ACL `{postgres=X/postgres,service_role=X/postgres}` preserved.
- Rollback source: `supabase/migration-reference/gift_card_deleted_order_reconciliation.rollback.sql`.
  Revert the companion Function/helper first, then replace the RPC with this previous body
  only after separately authorizing the target environment. The rollback definition was
  rehearsed inside a staging transaction and rolled back, leaving the new definition active.
- Rollback does NOT undo audited resolutions or re-reserve previously released balances.
  Never recreate a reservation or alter the ledger to simulate rollback.

## Validation results

- Full JS suite: **157/157 PASS**, including **50** new provider/actual-handler tests.
- New SQL suite: **70 assertions PASS**, service-role calls, synthetic fixtures, ROLLBACK.
- Existing SQL: mixed attempts/race/idempotency; Phase 2 total/mixed/reservations/refunds/
  receipts/45-day activation; Phase 2 roles; reversible block/unblock: all PASS with ROLLBACK.
- Current authenticated-actor SQL suites: **25 + 50 + 67 assertions PASS** (authorization,
  fail-closed admission, existing-operation completion, Phase 1, reservations, audit).
- Legacy `gift-card-operations.sql` assumes the removed service-role setter bypass;
  use the three current authenticated-actor suites above instead. No bypass was restored.
- SQL legacy suites needing admission were run with flags enabled and synthetic missing
  admin/manager/staff profiles seeded INSIDE their transaction, then ROLLBACK. Setup:
  `SET LOCAL search_path=public,extensions,pg_catalog`; set both staging operation flags
  true within the test transaction; create missing roles using synthetic `@example.invalid`
  Auth users/profile rows only. The authenticated-actor suites perform their own setup.
- Required negatives covered: approved or second approved charge, prior redemption,
  foreign checkout, applied/released reservation, approved attempt, repeat resolution,
  pending external order, wrong amount/PEN/ID/metadata, linked charge, competing attempt,
  missing actor, unauthorized roles and unavailable/ambiguous provider evidence.
- Idempotence SQL: second invocation leaves entire attempt audit row byte-for-byte logically
  unchanged, balance 40, no ledger movement; reserved sum remains 0.
- SQL positive fixture: balance 40, reservation 40 -> 0, available 40, card active,
  attempt cleared, order unpaid/expired, zero redemption/ledger movements.
- Lint, application typecheck/build and scoped Gift Cards/reconcile/webhook typecheck: PASS.
- Full `tsconfig.functions.json` has two pre-existing unrelated errors, untouched:
  `member-portal.ts:34 TS2558` and `member-promotions.ts:108 TS1355`.
- Build warning: existing ~593 kB frontend bundle (>500 kB); Node TS stripping experimental warning.
- Final staging: 2 cards, 3 orders, 4 movements, 2 existing reservation rows, 0 attempts,
  4 staff profiles; both flags FALSE; 0 residual synthetic test cards/users.
  Staging sequence counters may advance during rolled-back creation/audit tests, as designed.
- Before/after security advisors unchanged: existing intentional service-only tables with RLS
  and no public policies, existing authenticated SECURITY DEFINER RPCs, leaked-password
  protection warning. No new ACL exposure introduced.

Relevant advisory documentation:

- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Local commands (no deploy)

```powershell
node --test tests/*.test.mjs
node node_modules/oxlint/bin/oxlint
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target ES2023 --module ESNext --moduleResolution Bundler --types node --allowImportingTsExtensions --resolveJsonModule --esModuleInterop --skipLibCheck --strict netlify/functions/gift-card-reconcile.ts netlify/functions/culqi-webhook.ts netlify/lib/culqi-no-charge.ts
```

Stop here. Production rollout and real `cleared_no_charge` resolution require new authorization.
