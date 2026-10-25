# Checkpoint 20 — devoluciones externas seguras (STAGING ONLY)

## Estado de validación

Implementación local en `gift-cards-phase2-staging`. No se modificó producción, no se
crearon cargos/refunds reales, no se cambiaron precios ni se publicó ningún deploy.
Los cambios locales anteriores de conciliación se conservaron sin mezclarlos.

Conexión MCP restablecida y dependencias del esquema completo verificadas.
La migración `20261025184211_safe_culqi_external_refunds.sql` se aplicó una sola vez
en `kqfphrukxdvlrbjipjnx`; MCP la registró con versión remota `20261025190421`
y nombre `safe_culqi_external_refunds`. No reaplicar por la diferencia de timestamp.

Validación automatizada y DB staging: PASS. No equivale a un refund real contra
Culqi TEST ni a un deploy de la Function: ambos siguen pendientes.
La integración adicional con PostgreSQL embebido PGlite utiliza proveedor/Auth
simulados y no se presenta como evidencia del proveedor real.

Resultados de la reanudación:

- SQL de refund nuevo: 158 comprobaciones PASS con ROLLBACK.
- Regresión de conciliación deleted/no-charge: 70 PASS con ROLLBACK.
- Regresión de autorización, flags y pagos total/mixto: 50 PASS con ROLLBACK.
- Regresión Phase 1: 67 PASS con ROLLBACK.
- Total: 345 comprobaciones SQL en staging y 207 tests JS (50 nuevos), sin fallos.
- Lint, build y typecheck específico refund/webhook: PASS.
- Owner postgres, SECURITY INVOKER, search_path vacío, EXECUTE solo service_role;
  RLS habilitado y ACL mínima verificados en los objetos nuevos.
- Conteos conservados: 2 tarjetas, saldo agregado 50, 4 movimientos, 3 pedidos,
  5 ítems, 4 perfiles, 6 compras anteriores, 2 reservas anteriores y 0 attempts.
- 0 intenciones/auditorías de refund y 0 usuarios fixture persistentes.
- Hashes de filas completas de tarjetas, ledger, pedidos y reservas sin cambios.
- Ambos flags permanecen FALSE. Las secuencias de auditoría pueden avanzar pese
  al ROLLBACK; Phase 1 consumió dos números de secuencia sin dejar tarjetas.
- Advisor: RLS sin policies en tablas backend-only es intencional; avisos sobre
  SECURITY DEFINER de funciones anteriores y protección de contraseñas fuera de alcance.
- No commit, push, deploy, cambio productivo ni refund LIVE.

## Arquitectura / API

Nueva Function: `gift-card-external-refund`.
Solo POST autenticado con Admin/Manager activo verificado mediante Auth y staff_profiles.
Body permitido exclusivamente:

```json
{"orderId":"UUID del pedido","action":"create","note":"Justificación operativa auditada"}
```

`action=verify` consulta evidencia existente sin autorizar otro POST de devolución.
No se acepta importe, moneda, charge ID, refund ID, actor ni token de autorización
de envío proporcionados por el cliente. La respuesta no incluye credenciales,
headers, código de Gift Card, datos de beneficiario ni el token interno de envío.

Guard temporal explícito: únicamente `sk_test_*` y la URL exacta del proyecto staging.
LIVE u otra URL fallan con 503 **antes** de Auth/DB/proveedor. No se añade/cambia
ninguna variable. Una habilitación futura LIVE requiere revisión y autorización propias.

RPC nuevas, SECURITY INVOKER, owner postgres, search_path vacío, EXECUTE solo service_role:

- `external_refund_snapshot(uuid,uuid)`.
- `prepare_external_refund(uuid,uuid,text,boolean)`.
- `claim_external_refund_post(uuid,uuid,uuid,uuid)`.
- `record_external_refund(uuid,uuid,uuid,text,text,bigint,text,text,integer,text)`.

Las RPC verifican nuevamente al actor Admin/Manager activo. No se amplían permisos
del schema private ni se restaura el bypass del setter administrativo.

Dos tablas nuevas con RLS y sin acceso anon/authenticated:

- `culqi_external_refunds`: única intención por pedido, checkout y cargo; refund ID único;
  snapshot de identidades, importe, PEN, estado, actor/fechas, estado/HTTP Culqi,
  error genérico sanitizado, token interno y marca permanente de autorización del POST.
- `culqi_external_refund_audit`: eventos append-only para el backend (SELECT/INSERT),
  con estados anterior/nuevo, actor, fecha, refund ID y justificación.

Se revocan explícitamente los default privileges de las tablas nuevas, incluido
DELETE/TRUNCATE para service_role. No se cambian default ACL globales ni tablas previas.

## Elegibilidad y seguridad financiera

Esta primera versión cubre pagos mixtos rechazados con Gift Card ya restituida.
No amplía el rechazo/reembolso de pedidos legacy sin Gift Card.

- Pedido `rechazado / refund_pending`, external pending, Gift Card refund completed.
- Reserva existente `refunded` con fecha de restitución.
- Exactamente un redemption online y una restitución por el importe Gift Card del pedido.
- Attempt approved vinculado al cargo y al mismo checkout/order/reserva; sin intentos inciertos.
- Split/total e identidades reconstruidos desde DB y revalidados bajo bloqueo.
- GET del charge: ID del entorno, monto externo exacto, PEN, capture=true,
  outcome venta_exitosa/AUT0000, descripción exacta, metadata checkout/attempt y
  cualquier referencia order informada coherentes. `paid` no se usa aisladamente.
- GET /v2/refunds con paginación completa (máximo 10×100; exceder falla cerrado),
  sin limitar por fecha para no ocultar una devolución anterior.
- Refund anterior completo: verificar por GET su ID e importar la evidencia sin POST.
- Refund previo parcial, duplicado, incompatible o evidencia incompleta: revisión; no top-up.

POST oficial, una sola vez:

```json
{"amount":1000,"charge_id":"cargo TEST reconstruido por backend","reason":"solicitud_comprador"}
```

Contrato oficial consultado: https://apidocs.culqi.com/ (Crear/Listar/Consultar devolución).
`solicitud_comprador` pertenece al enum real de la API, aunque el motivo operativo local
sea falta de stock. La justificación comercial real se conserva separadamente en auditoría.
No se inventan headers de idempotencia ni se depende de soporte del proveedor no documentado.

## Idempotencia, concurrencia y ambigüedad

Bloqueos siempre pedido → reserva → intención. La primera preparación obtiene un token
interno exclusivo. La autorización transaccional marca `post_started_at` una sola vez
antes de contactar Culqi. No hay RPC de reset/expiración/recuperación automática del token.
Una segunda Function nunca recibe otra autorización de POST, incluso si la primera
se cae, recibe timeout, 4xx/5xx o no logra persistir su respuesta.

La imposibilidad de obtener evidencia completa no significa ausencia de devolución.
Toda repetición consulta la lista/GET de refunds; si no se puede determinar, queda
`reconciliation_required`, nunca reenvía. La política es conservadora: incluso un fallo
pre-POST puede requerir revisión y perder disponibilidad, pero no permite doble devolución.

Estados locales: processing, pending, completed, rejected, reconciliation_required.
201 + Pendiente conserva pending y refund_id. Solo Completa/Completado verificado,
con ID/cargo/monto correctos y HTTP 200/201, cierra el pedido en la misma transacción:
external_payment_refund_status=completed, payment_status=refunded, status sigue rechazado.
No se modifica Gift Card, historial, reserva, items, attempt de cobro ni flags.

La caché del pedido se sincroniza con el mecanismo existente getOrder/saveOrder,
verificando checkout/charge. Si falla, se devuelve una advertencia de sincronización
pendiente sin repetir el refund; `verify` puede reintentar solo esa sincronización.
Una repetición ya completed no crea una nueva fila de auditoría financiera.

## Webhooks

No se modifica `culqi-webhook` ni `order.status.changed`. Los eventos refund.creation.*
y refund.update.* quedan como siguiente integración. La verificación explícita con
Auth y GET del proveedor ya permite avanzar pending/incierto a completed/rejected.
No configurar eventos refund.* contra el handler antiguo esperando que los procese.

## Validación local

- 50 tests nuevos del handler real y helpers con transporte Auth/DB/Culqi simulado:
  positivo, Admin/Manager, staff/inactivo/sin perfil/no sesión, charge inexistente,
  monto/PEN/referencias incorrectos, datos financieros manipulados, existencia previa,
  parcial, duplicados/concurrencia, pending, rejected, timeout, HTTP/JSON incompleto,
  persistencia fallida después del POST, paginación y sincronización de caché.
- `tests/culqi-external-refund.sql`: 158 assertions, ROLLBACK, usando RPC reales sobre
  PostgreSQL embebido y esquema fixture mínimo. Verifica autorización, elegibilidad,
  claim único, auditoría, finalización, idempotencia, ACL y cero cambios en saldo/reserva/ledger.
- Integración local adicional: Function real + wrappers DB reales + RPC reales;
  proveedor/Auth simulados. Un POST 1000, pending → completed, repetición estable,
  cuatro eventos de auditoría, saldo 40 e historial de cuatro movimientos sin cambios.
- Después de ROLLBACK: 0 pedidos/intenciones/auditorías/usuarios sintéticos persistentes.
- La suite JS de regresión cubre Gift Cards, mixed attempts, webhook, Culqi, orders,
  idempotencia, permisos y fail-closed. No se ejecutan pagos ni peticiones financieras reales.
- Lint, build y typecheck específico de Function/refund/helpers/webhook pasan.
- Aviso preexistente: bundle frontend >500 kB; sin refactor ajeno al alcance.

## Pendiente para validación real del proveedor

La migración y las pruebas automatizadas anteriores ya están completadas. Falta:

1. Usar credenciales TEST y cargo TEST sintético válido; no crear ni copiar un cargo LIVE.
2. Si se autoriza publicar staging, preparar únicamente los archivos del refund, sin
   incluir los cambios previos no relacionados que ya estaban en el worktree.
3. Verificar un refund TEST de S/10 real y su estado terminal, nunca inferirlo del mock.
4. Registrar evidencia de saldo/reserva/historial intactos. No recomendar ejecución LIVE
   basándose únicamente en esta validación automatizada.

## Rollback

No aplicado en este checkpoint. Retirar primero la nueva Function o bloquear su entrada.
El SQL de referencia revoca únicamente el acceso a las nuevas RPC para detener escrituras.
No elimina tablas ni auditoría ni cambia pedidos. Nunca deshacer una devolución real con
UPDATE de saldo, re-cargo, re-reserva o borrado de evidencia. Las devoluciones completadas
son hechos financieros no reversibles mediante rollback de código.
