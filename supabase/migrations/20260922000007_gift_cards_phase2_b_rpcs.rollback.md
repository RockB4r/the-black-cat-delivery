# B — rollback funcional de RPC nuevas

Detener primero tráfico Phase 2 y conciliar todas las reservas/pagos con Culqi. Después, en una transacción revisada, revocar EXECUTE a `service_role` de las cinco funciones nuevas (`finalize_gift_card_purchase`, `reserve_gift_card_for_order`, `apply_gift_card_to_order`, `release_gift_card_order_reservation`, `reject_gift_card_order`). Esto desactiva operaciones nuevas sin borrar las funciones, compras ni auditoría. No revocar permisos de Fase 1.

No hacer `DROP FUNCTION` hasta verificar que no quedan pagos pendientes y haber preservado las definiciones. Una compra/canje ya ejecutado no se revierte eliminando la RPC: requeriría conciliación y, de ser procedente, devolución auditada. Validar que endpoints Phase 2 fallan cerrados y Fase 1 sigue disponible.
