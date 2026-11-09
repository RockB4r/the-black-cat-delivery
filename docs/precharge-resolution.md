# Resolución pre-charge — staging TEST

`POST /.netlify/functions/gift-card-precharge-resolve` recibe únicamente `orderId`, `checkoutId`, `note`; bearer Auth de Admin/Manager activo. No recibe actor, evidencia ni importes del cliente. Doble control de rol: Auth/perfil en backend y perfil activo en RPC. Backend usa service_role únicamente como credencial interna para la RPC, nunca como operador humano.

No desplegar a producción ni usar LIVE sin revisión/autorización separada. Implementación protegida por hostname exacto de Supabase staging y entorno TEST. No invocar sobre el checkout real durante la implementación.

Backend hace solo GET a Culqi: orden `deleted`, identidad/monto/PEN exactos y escaneo paginado completo sin filtros de importe/fecha que puedan ocultar un cargo vinculado. Cualquier cargo asociado, incluso rechazado o con importe incorrecto, bloquea; lista incompleta/error/objeto inidentificable bloquea. `paid_at` aislado no representa aprobación del proveedor. No modifica orden Culqi.

RPC `resolve_precharge_gift_card_order(uuid,uuid,uuid,text,jsonb)` SECURITY INVOKER, search_path vacío, EXECUTE solo service_role. Bloquea pedido -> reserva, igual que begin/complete/release; comprueba identidad/split, no pagado, cero attempts de cualquier estado, cero redemptions y cero intents de refund. Evidencia backend fresca <=2 minutos. Solo admite reserva reserved/payment_pending. Orden externa permitida: únicamente deleted.

Transacción inserta auditoría `gift_card_precharge_resolutions`, marca pago expired y llama la RPC de release existente. No cambia balance ni ledger, ni crea attempts/refunds. reserved_balance es suma de reservas reserved, no una columna que se actualice manualmente. reservation_id en auditoría es checkout_id, PK real de gift_card_order_payments.

Una fila de auditoría por pedido/checkout/reserva/orden Culqi. Guarda actor, fecha, motivo, identidad, snapshot previo y evidencia no sensible. RLS sin policies públicas; anon/authenticated sin acceso. service_role SELECT/INSERT, sin UPDATE/DELETE/TRUNCATE. Repetición coherente devuelve idempotent=true sin insertar ni liberar nuevamente; released sin auditoría previa se rechaza. Locks serializan con begin_mixed_culqi_attempt; tras el commit esa ruta rechaza payment_status expired. Cache Netlify se sincroniza después: fallo devuelve cacheSyncPending, una verificación/repetición explícita puede resincronizar sin segunda liberación.

Pruebas SQL sintéticas en ROLLBACK; proveedor mockeado en JS. No pagos ni resolución de datos operativos. La evidencia externa nunca se fabrica para resolver una operación real.

Validación 21H: 19 escenarios SQL en staging con ROLLBACK y bajo service_role, regresión mixed attempts/3DS/external refund en ROLLBACK, 250 tests JS. Dos callers contra RPC local PGlite obtienen una resolución y un replay idempotente; PGlite serializa en una conexión, no simula una carrera física entre dos sesiones PostgreSQL. Esa prueba remota no se ejecutó: la revisión automática rechazó fixtures persistentes con Admin sintético sin cleanup incorporado, y Docker local no estaba activo. No quedan fixtures persistentes por estas pruebas.

Migración local creada por CLI: `20261106161843_safe_precharge_gift_card_resolution.sql`. MCP staging registra versión `20261106162241` con nombre `safe_precharge_gift_card_resolution` (mismo SQL). No reaplicar por diferencia de timestamp ni ejecutar db push.

Rollback: ver `supabase/migration-reference/safe_precharge_gift_card_resolution.rollback.sql`. Retirar/deshabilitar Function primero. Conservar auditoría si hubo resoluciones; no reabrir órdenes ni reservas ya liberadas. Esta migración no modifica las RPC financieras preexistentes.
