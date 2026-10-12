# C — restaurar RPC de Fase 1

Antes de restaurar `redeem_gift_card`, detener y conciliar todas las reservas `reserved`; la versión antigua no descuenta saldo reservado y podría causar doble gasto. Solo entonces reemplazar en una transacción la definición de `redeem_gift_card` tomada de `20260922000000_gift_cards_phase1.sql` y la definición segura de `block_gift_card` tomada de `20260922000002_gift_card_null_role_guard.sql`. No ejecutar esas migraciones enteras: contienen DDL para otros objetos. Mantener `unblock_gift_card` de Fase 1 sin cambios.

El guard `coalesce` del bloqueo es obligatorio también en rollback. Conservar movimientos históricos y comprobar canje parcial/total, bloqueo/desbloqueo y rechazo de cuenta sin perfil.
