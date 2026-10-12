# A1 — rollback funcional

Primero desactivar en Netlify el flujo Phase 2 y conservar A1 instalada. No eliminar columnas, índices ni tablas con compras, reservas, canjes o reembolsos. Las columnas nuevas son compatibles con Fase 1 y los registros anteriores conservan `purchase_channel`/`payment_method` nulos.

Si aún no se ejecutó ninguna operación Phase 2 y un DBA verificó que ambas tablas nuevas están vacías, puede planificar una reversión estructural en ventana de mantenimiento; no es automática. Las columnas y tablas nuevas pueden contener evidencia financiera una vez utilizada la función. No revertir `performed_by` a `NOT NULL` mientras existan movimientos automáticos.

Verificar tras rollback funcional: crear/canjear una tarjeta Fase 1 y registrar un pedido tradicional.
