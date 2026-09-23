# D — restaurar RPC de pedidos

La definición exacta previa de `create_kitchen_order_with_items(jsonb,jsonb)` está en `../migration-reference/create_kitchen_order_with_items_before_phase2.sql`, capturada de producción el 2026-09-22. Reemplazarla in situ en una transacción, sin rename/drop, y comprobar EXECUTE `service_role` y ausencia para `anon`/`authenticated`. No eliminar `receipt_legal_name`: facturas emitidas durante Phase 2 pueden depender de ese dato.

Probar pedido tradicional nuevo, reintento con el mismo `checkout_id` y lectura de pedido legacy con `checkout_id` nulo. La restauración de la función no revierte pagos, pedidos ni comprobantes ya creados.
