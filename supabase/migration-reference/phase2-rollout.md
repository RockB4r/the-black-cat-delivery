# Gift Cards Phase 2 — plan de aplicación (no ejecutar todavía)

## Antes de tocar producción

Tomar snapshot/backup de la base con recuperación puntual y exportar definiciones/ACL de `gift_cards`, `gift_card_transactions`, `orders`, `order_items` y las RPC de Gift Cards y pedidos. Guardar también el deploy actual de Netlify. Congelar nuevos pagos durante la ventana de aplicación. Verificar que la migración monolítica `00004` no esté en `supabase/migrations` ni aplicada en `supabase_migrations.schema_migrations`.

## Orden y prueba de salida

1. `00005` A1 esquema: comprobar nuevas columnas, índices, constraints, RLS activa en tablas nuevas y que compra/canje Fase 1 y pedido tradicional siguen funcionando. Los registros legacy deben conservar `purchase_channel` y `payment_method` nulos.
2. `00006` A2 backfill: comprobar `online_payment_code` no nulo y único, sin cambios de saldo ni procedencia. Validar la nueva constraint de auditoría.
3. `00007` B RPC nuevas: comprobar EXECUTE solo `service_role`; probar en staging compra pendiente/confirmada, doble confirmación, reserva simultánea, expiración sin pago, pago Culqi pendiente/aprobado, referencia/monto/moneda incorrectos, rechazo mixto y refund externo pendiente. No activar frontend aún.
4. `00008` C RPC Fase 1: ejecutar pruebas de admin, manager, staff y cuenta sin perfil para bloquear; verificar canje presencial parcial/total, bloqueo, desbloqueo, vencimiento y concurrencia con reserva web.
5. `00009` D pedidos: verificar firma `(jsonb,jsonb)`, `SECURITY DEFINER`, grants y checkout actual; registrar pedido tradicional y reintentar el mismo `checkout_id` sin duplicar `order_items`; consultar pedido legacy con `checkout_id` nulo; probar boleta/factura con `receipt_legal_name`.

Después aplicar deploy de backend/frontend Phase 2 de forma coordinada. Mantener monitor de reservas con `payment_state='reconciliation_required'`, cargos aprobados sin `status='applied'` y `external_payment_refund_status='pending'`; estos casos requieren conciliación humana antes de liberar saldo. No existe refund Culqi automático.

## Matriz de permisos prevista

| Objeto | anon | authenticated sin perfil | staff | manager/admin | service_role |
|---|---|---|---|---|---|
| `gift_card_purchases`, `gift_card_order_payments` | Ninguno | Ninguno | Ninguno | Ninguno directo | SELECT/INSERT/UPDATE; RLS bypass |
| `gift_cards`, `gift_card_transactions` | Ninguno | Ninguno por RLS | SELECT | SELECT | SELECT/INSERT/UPDATE; RLS bypass |
| `orders` | Ninguno | Ninguno por RLS | Sin lectura salvo cuenta técnica kitchen | SELECT | SELECT/INSERT/UPDATE; RLS bypass |
| `order_items` | Ninguno | Ninguno por RLS | Sin lectura salvo cuenta técnica kitchen | SELECT | SELECT/INSERT/UPDATE; RLS bypass |
| RPC B nuevas (5) | Sin EXECUTE | Sin EXECUTE | Sin EXECUTE | Sin EXECUTE directo | EXECUTE |
| `create_gift_card` | Sin EXECUTE | Denegado por guard | Denegado | EXECUTE permitido | Solo si existe perfil admin/manager |
| `redeem_gift_card` | Sin EXECUTE | Denegado por guard | EXECUTE permitido | EXECUTE permitido | Solo si existe perfil de staff |
| `block_gift_card`, `unblock_gift_card` | Sin EXECUTE | Denegado por guard | Denegado | EXECUTE permitido | Solo si existe perfil admin/manager |
| `create_kitchen_order_with_items` | Sin EXECUTE | Sin EXECUTE | Sin EXECUTE directo | Sin EXECUTE directo | EXECUTE |

En producción al 2026-09-22 `authenticated` solo tiene UPDATE de columna `orders.status`, no de las nuevas columnas financieras. Las políticas RLS de pedidos permiten SELECT a kitchen técnico y manager/admin; el UPDATE existente aplica a kitchen técnico/admin, pero no concede UPDATE de importe, Gift Card o refunds. Confirmar de nuevo este detalle inmediatamente antes de A1.

## Reserva y conciliación

La reserva vence a 90 minutos, pero el vencimiento **no** equivale a impago. Sin referencia Culqi, se libera bajo lock. Con orden Culqi, Netlify consulta el estado auténtico y valida ID, número, monto y PEN: pagada → aplica Gift Card; expirada → marca pedido/reserva y libera. Con cargo directo vinculado, se consulta primero ese cargo; si no se confirma como aprobado, se conserva y marca `reconciliation_required` para revisión. Un cargo incierto nunca se libera automáticamente. Las consultas/cotizaciones disparan esta conciliación bajo demanda; no hay cron.

El pago mixto puede requerir conciliación manual si Culqi queda en estado incierto, si el cargo y la orden discrepan o si el pago llega después del vencimiento de la tarjeta. No forzar `released` ni reutilizar saldo hasta resolverlo. Una aprobación de Culqi y el canje Gift Card son operaciones en sistemas distintos; no hay transacción distribuida. Los índices únicos y la RPC idempotente previenen doble canje, pero no sustituyen la revisión de posibles cargos externos duplicados.

## Rollback

Cada SQL tiene un `.rollback.md` al lado. El rollback funcional desactiva Phase 2 y conserva evidencia financiera. Nunca ejecutar `DROP TABLE` o borrar compras, movimientos, pedidos o reembolsos para revertir. La definición exacta anterior de pedidos está en `create_kitchen_order_with_items_before_phase2.sql`.
