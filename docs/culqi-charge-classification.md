# Clasificación de cargos — checkpoint 21K (staging)

Fuentes oficiales revisadas:
- https://apidocs.culqi.com/#tag/Cargos (outcome, capture, códigos HTTP y errores de tarjeta).
- https://docs.culqi.com/es/documentacion/pagos-online/cargo-unico/captura/ (capture=true: captura inmediata; capture=false: autorización/retención con captura posterior).
- https://docs.culqi.com/es/documentacion/culqi-3ds/v1/uso-libreria/ y demo oficial https://github.com/culqi/culqi-php-demo-checkoutv4-culqi3ds (REVIEW y continuación con mismo source/device).

La referencia describe outcome como éxito/denegación y capture como captura. Su descripción de paid duplica la de dispute; no es una base fiable para inferir autorización o denegación. No se atribuye aquí un significado de liquidación/abono a paid. authorization_code es la referencia de autorización del emisor, no OTP, credencial ni sustituto de contexto financiero. Mensajes de texto no autorizan un cargo por sí solos.

## Decisiones

| Resultado | Regla |
|---|---|
| approved con paid=false | HTTP exitoso, ID/entorno/monto/PEN/descripción coincidentes; outcome.type=venta_exitosa y outcome.code=AUT0000; capture=true; authorization_code no vacío y con formato acotado; metadata.checkout_id/attempt_id obligatorias cuando forman parte de la expectativa; sin señales negativas/contradicciones. captured/state/status/response_code null no rechazan. |
| failed | Evidencia positiva de denegación sin autorización contradictoria: operacion_denegada, código DNGA/DNGE, decline_code explícito o estado/acción explícitamente rechazados. paid=false aislado, ausencia de campos, códigos desconocidos o capture=false aislado no son denegación. |
| authentication_required | Señal REVIEW explícita y coherente en el paso inicial ya implementado. Mantiene intento processing/awaiting_3ds y reserva protegida; no es aprobación. No se modifica el listener ni la continuación. |
| ambiguous | Autorización y denegación en conflicto; autorización con mismatch financiero/contextual; captura negativa; señales desconocidas/malformadas; evidencia incompleta; HTTP201 sin autorización. Se conserva la reserva y el backend usa reconciliation_required. |
| invalid | Objeto/HTTP/identidad inválidos sin evidencia positiva de autorización; nunca se aprueba. |

Se conservan los formatos explícitos de éxito previamente soportados por el helper (response_code=venta_exitosa, state=Exitosa o outcome.type=venta_exitosa, sin paid=false ni señales contradictorias). No se introduce una aprobación por paid=true ni por status HTTP. La nueva aceptación de paid=false exige el contrato completo descrito arriba; metadata ausente no se inventa. response_code=AUT0000 informado es compatible con autorización, pero no la demuestra por sí solo.

El GET real aportado por el usuario tiene outcome.code=AUT0000 y response_code=null: son campos distintos. El fixture de regresión reproduce capture=true, captured=null, paid=false, state/status/action_code/response_code/decline_code null, metadata y descripción coincidentes. Se reemplaza el authorization_code por un valor sintético. La descripción sanitizada `[NUMBER]` no se usa literalmente: se verifica la descripción esperada completa. El fixture offline se clasifica approved; esto NO aplica reservas, finaliza pedidos ni concilia el cargo existente.

No cambia el control de reutilización del charge, los hashes source/device/checkout/amount ni la idempotencia transaccional. Un segundo POST autenticado con autorización contradictoria permanece reconciliation_required; nunca inicia un tercer cargo. La corrección es local en gift-cards-phase2-staging, sin migraciones, despliegues ni llamadas reales a Culqi. Revisar el alcance del helper compartido antes de una publicación futura; compras independientes y otros consumidores pasan regresión, sin cambiar sus flujos.
