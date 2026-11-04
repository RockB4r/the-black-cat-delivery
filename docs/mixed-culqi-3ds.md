# Mixed Gift Card + Culqi 3DS (staging first)

Scope: mixed orders paid with Gift Card + card only. Not GiftCardPurchase.tsx /
gift-card-charge.ts: that separate integration is explicitly pending. Yape does not
enter card authentication. Automated tests never call Culqi or create real payments.

## Provider contract

- https://docs.culqi.com/es/documentacion/culqi-3ds/v1/configuracion/
- https://docs.culqi.com/es/documentacion/culqi-3ds/v1/uso-libreria/
- https://docs.culqi.com/es/documentacion/checkout/checkout-custom
- https://github.com/culqi/culqi-php-demo-checkoutv4-culqi3ds/blob/master/js/main.js

Documentation reverses HTTP 200/201 between pages. HTTP alone is NOT approval.
The official demo uses explicit action_code REVIEW. Unknown shapes or free-text
messages remain uncertain, not an automatic retry/challenge. Approval requires
identity, exact money/PEN/description/metadata and positive body evidence; explicit
paid=false or rejection always prevents approval.

## Context and continuation

Load/configure Culqi3DS only for mixed card, with current public key. Generate UUID-v4
device before first POST; keep source/fingerprint in memory, reused after authentication.
PAN/CVV/OTP never touch our backend. Only SHA-256 context binding (checkout, DB order,
source, device, money/currency) and hash of random 256-bit capability are persisted.
Never log capability, token, or 3DS proofs.

Attempt status remains processing, so existing unresolved index, webhook, release
and reconciliation protections remain active. Additional phases: initial_request_sent,
awaiting_3ds, authenticated_request_sent, authentication_failed. TTL is min(reservation
expiry, 10 minutes); expiry alone NEVER permits releasing money.

Keep general Blob lock. Only an atomic backend transition with matching context and
capability can authorize one authenticated POST. Duplicate callbacks/tabs cannot claim
it twice. Validate event origin, active checkout/order and strict authentication fields.
For protocol 2.x directoryServerTransactionId is required; 1.x may omit it.

Use existing complete_mixed_culqi_attempt for one redemption/application; preserve
webhook/HTTP race idempotence. Cancellation/failure has no second charge; uncertainty
retains reservation. Timeout NEVER resends. A refresh marker contains only order and
checkout IDs, not secrets; it blocks automatic resubmission and is NOT financial
idempotency. Lost UI context requires reconciliation. Reset SDK after termination,
not between first POST and authentication.

## Migration / safe rollback

20261104000842_mixed_culqi_3ds_continuation.sql is additive.
Staging MCP recorded this same migration as version 20261104001734. Do not reapply
the file merely because the generated local/remote timestamps differ; compare name/SQL.
RPC: SECURITY INVOKER, empty search_path, service_role EXECUTE only. No new anon/authenticated grants.
Lock order: order -> reservation -> attempt. Existing financial RPCs unchanged.

Before application rollback suspend admission operationally, keep webhook/reconciliation
available and inspect unresolved contexts. NEVER delete locks/attempts/reservations to
reset a payment. Prefer retaining additive columns/RPC; revert application only to a
version retaining body-based approval checks. Destructive down migration is not automatic
and requires zero unresolved 3DS contexts plus separate review.

Publication and real browser/provider 3DS verification are separate checkpoints.
Mock/SQL success is NOT evidence of a completed real TEST bank challenge.
The refresh marker is deliberately fail-closed after uncertainty/cancellation; only a
verified reconciliation may authorize retiring it. There is no automatic retry button.
# Preparación del dispositivo

El SDK se carga al seleccionar Gift Card. En un pago mixto se genera el fingerprint antes de crear la orden y abrir Checkout; el callback del token reutiliza ese mismo dispositivo ligado al checkout. No se persisten tokens ni fingerprint en storage. El importe del SDK se ajusta al residual confirmado por el backend.

