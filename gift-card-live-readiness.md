# Gift Cards Phase 2 — preparación LIVE

Fecha: 2026-10-11. Solo preparación; este documento NO autoriza ejecutar el rollout.

## Controles de código

- Autoridad backend: `CULQI_SECRET_KEY`. Clave desconocida falla cerrada. TEST admite exclusivamente IDs `chr_test_`/`ord_test_`; LIVE exclusivamente `chr_live_`/`ord_live_`.
- POST original: HTTP 201 puede aprobar con campos de estado ausentes si coinciden ID, monto, PEN, descripción y metadata de checkout cuando existe. Un estado explícitamente fallido nunca se aprueba.
- GET posterior: exige evidencia explícita `venta_exitosa` o `Exitosa`, sin estado contradictorio. Ausencia de ambos es ambigua, no aprobación. HTTP 200 por sí solo no demuestra pago.
- Conciliación manual: admin/manager activo, actor y justificación auditados, entorno correcto, pedido/checkout coincidentes. Se verifica el cargo en API autenticada; la reserva ambigua se conserva. Se comprueba propiedad del cargo entre pedidos, compras e intentos y se mantienen constraints e idempotencia SQL.
- Webhook: rechaza IDs de otro entorno y consulta Orders API autenticada antes de aplicar pago/expiración. No confía en el estado recibido en el evento. Los intentos inciertos impiden liberar reservas por tiempo.
- `culqi-config` devuelve solo entorno, sin claves. Frontend compara con su llave pública antes de preparar el pago. No sustituye validación backend.
- No se requiere migración nueva para estos cambios; no se reescribieron migraciones aplicadas.

## Orden seguro de rollout — pendiente de aprobación y ejecución

1. **Backup:** confirmar snapshot/backup/PITR recuperable del proyecto productivo, fecha, retención y punto de recuperación. Verificar restaurabilidad restaurando en proyecto aislado y comparando esquema, funciones, permisos y totales financieros. No basta ver un plan con backups. Restringir y cifrar cualquier copia con datos reales; no usar staging de pruebas sintéticas para datos personales. Respaldar por separado Netlify Blobs de pedidos/locks, despliegue actual y configuración: Supabase no respalda Blobs.
2. **Preflight:** confirmar refs/sitio/rama, inventariar versiones SQL realmente aplicadas y definiciones actuales, revisar locks y reservas pendientes, comprobar hashes de SQL aprobado y recuperación ensayada. Registrar responsable, ventana y criterios de aborto. No reparar a ciegas el historial remoto.
3. **Migraciones:** aplicar explícitamente cada archivo de la lista siguiente, en orden, uno por uno con registro de resultado. Verificar esquema después de cada paso y detenerse ante error. No ejecutar `supabase db push` indiscriminadamente. No añadir versiones al ledger hasta demostrar que el cambio se aplicó.
4. **Variables:** configurar únicamente tras autorización y verificar scopes/proyecto; valores nunca en Git ni chat. Backend secret/service role exclusivamente Functions; llave pública exclusivamente frontend.
5. **Deploy:** publicar release previamente validado y comprobar frontend/Functions. No abrir nuevos flujos financieros hasta terminar webhook y smoke tests.
6. **Webhook:** registrar en Culqi LIVE la URL/evento de abajo y comprobar entrega, reintentos y logs.
7. **Smoke tests:** operaciones LIVE únicamente con aprobación separada; cubrir Fase 1, creación/consulta Gift Card, pago total y mixto, permisos admin/manager/staff, boleta/factura por total del consumo, saldo, canje único, transacciones y webhook duplicado. La compra de Gift Card conserva su constancia, no debe duplicar la venta del consumo.
8. **Monitorización:** vigilar backlog de conciliación, reservas, cobros, movimientos y errores antes de declarar estable.

## Migraciones exactas y orden

1. `20260922000005_gift_cards_phase2_a_structure.sql`
2. `20260922000006_gift_cards_phase2_a_backfill.sql`
3. `20260922000007_gift_cards_phase2_b_rpcs.sql`
4. `20260922000008_gift_cards_phase2_c_phase1_functions.sql`
5. `20260922000009_gift_cards_phase2_d_orders.sql`
6. `20261001000000_gift_card_mixed_culqi_attempts.sql`

Excluir `supabase/staging_migrations/`, restauraciones `restore_kitchen_status_staging`, disponibilidad de productos de staging y cualquier objeto que producción ya tenga. No ejecutar el monolito retirado 00004.

## Variables usadas — solo nombres

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_CULQI_PUBLIC_KEY`
- `CULQI_SECRET_KEY`

Verificar que ambas URLs/credenciales Supabase pertenecen al proyecto esperado; frontend usa publishable, nunca service role. Para LIVE, frontend `pk_live_` y backend `sk_live_`; confirmar `culqi-config` devuelve `live`. No se añade otra variable para decidir TEST/LIVE. Las necesidades de notificaciones se mantienen según la configuración existente; no cambian en esta corrección.

## Webhook LIVE preparado, NO creado

URL: `https://theblackcatrockbar.com/.netlify/functions/culqi-webhook`

Evento: `order.status.changed`. POST JSON por HTTPS. El código actual no requiere una variable de firma adicional: verifica evidencia mediante la API autenticada de Culqi. Confirmar modo LIVE, entrega, retries e idempotencia antes de habilitar tráfico. No aceptar solamente el estado del payload.

## Condiciones de aborto

- Backup no recuperable o restauración no ensayada.
- Proyecto/entorno incorrecto, mezcla TEST/LIVE o clave desconocida.
- Esquema/historial remoto incompatible, migración fallida, permisos o RLS inesperados.
- Functions no cargan, webhook no verificable, regresión Fase 1 o pedidos normales.
- Saldo negativo, doble canje/cargo/pedido, descuadre de importe/PEN/comprobante.
- Reserva incierta liberada automáticamente, pedido paid sin movimiento esperado o movimiento sin pedido paid.

Al abortar: suspender nuevas operaciones, conservar reservas/evidencia y conciliar pagos externos antes de recuperar. No declarar rechazado un pago cuyo resultado es incierto.

## Rollback

- Guardar release previo de frontend y Functions. Revertir el despliegue puede reintroducir validaciones antiguas inseguras: no reabrir pagos sin comprobarlas.
- Deshabilitar nuevas compras públicas/pagos mixtos mediante un control operativo previamente verificado; no asumir que exista un feature flag. Si no existe, preparar y aprobar un mecanismo de mantenimiento antes del rollout. No usar un cambio arbitrario de llaves como interruptor.
- SQL solo con plan revisado y seguro: restaurar definiciones previas de RPC/RLS/grants desde respaldo o scripts revisados. Mantener estructuras aditivas e historial cuando haya movimientos reales; nunca borrarlos sin conciliación.
- Un restore de base de datos NO revierte cargos Culqi ni repone eventos posteriores al snapshot. Conciliar todo lo posterior al punto recuperado, incluyendo Blobs, antes de reabrir.

## Monitorización

Registrar sin secretos/PII innecesaria: `reconciliation_required`, reservas >90 minutos (edad no autoriza release), intentos processing/rejected/approved, referencias reutilizadas y duplicados, pedidos paid sin redemption esperado, redemption sin pedido paid, errores/retries de webhook y errores Culqi. Los intentos inciertos deben seguir retenidos hasta evidencia verificable o conciliación manual auditada.

## Límites de esta entrega

Solo tests simulados TEST/LIVE y SQL sintético con ROLLBACK en staging. No cargos LIVE, backup productivo, cambios de claves LIVE, webhook LIVE ni migraciones/despliegue productivos. El typecheck global conserva los dos errores preexistentes de member-portal/member-promotions; fuera del alcance. Readiness definitivo depende también de publicación y health checks de staging.
