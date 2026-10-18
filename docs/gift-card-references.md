# Referencias de Gift Cards

## Presencial (/staff)

La referencia de cuenta / venta es texto operativo obligatorio (máximo 120 caracteres).
Admite número de Wally / Caja, cuenta, comanda, mesa + cliente, o comprobante si ya existe.
No requiere emitir boleta/factura antes del canje; esto no elimina las obligaciones de
documentar el consumo en Caja y emitir el comprobante que corresponda.

El frontend envía el texto con trim() a redeem_gift_card mediante p_reference.
La RPC existente lo guarda en gift_card_transactions.reference, con consumption_channel
in_store, performed_by = auth.uid() y fecha del movimiento. No se modifica esa RPC.

La combinación Gift Card + referencia participa en la idempotencia existente. Para
consumos diferentes, usar referencias distintas; añadir fecha/comanda a «Mesa 4 - Juan»
si es necesario. No usar Gift Card ID, checkout ID ni Culqi ID como referencia presencial.

## Online

El cliente no introduce referencias de Caja, mesa, venta, boleta o factura para autorizar
el pago. El checkout genera checkout_id y el backend vincula la reserva de Gift Card con
checkout_id y order_id en gift_card_order_payments.

Al aplicar el pago, gift_card_transactions guarda automáticamente reference = número
interno del pedido, consumption_channel = online, order_id y
source_reference = online_order:<order_id>. El checkout_id se obtiene mediante la
relación pedido/reserva. Esta lógica, su idempotencia y Culqi permanecen sin cambios.

## Historial y alcance

/staff muestra el canal guardado y distingue la referencia manual de la automática.
Si un movimiento histórico no tiene canal, conserva «Referencia», sin inferir ni
reescribir datos. Se muestra el order_id cuando existe.

Cambio exclusivamente de presentación; sin migración, cambios financieros, permisos,
flags ni movimientos históricos. Las pruebas del handler usan una RPC simulada en memoria;
no ejecutan canjes ni escriben en Supabase.
