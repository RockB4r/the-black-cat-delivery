# Runbook operativo del candidato Gift Cards Phase 2
Fecha: 2026-10-12. Preparación solamente. NO rollout, cambios productivos, cobros LIVE, webhook nuevo ni merge/push a main.

## Estado y checkpoint
Código candidato tomado del staging validado; paquete aislado de flyers/emails VIP/fixtures.
Backup creado: PENDING. Restore ensayado: PENDING. No se descargaron datos reales ni credenciales.
Certificación backend y Culqi/webhook: PENDING. No afirmar PASS con valores ocultos.
Suspensión segura: propuesta, NO implementada; requiere autorización antes de código/SQL nuevo.
Herramientas supabase, pg_dump/pg_restore/psql y docker no se encontraron en PATH en esta comprobación. No se instaló software. Confirmar instalaciones/rutas antes de generar respaldo.

## Backup lógico (procedimiento no ejecutado)
Fuente hhqcshtzhzzgibmhvuue, PostgreSQL 17; usar CLI Supabase fijada a versión verificada y Docker/psql compatibles. Descubrir comandos con --help. No usar supabase db push.
Destino del ensayo: instancia Supabase local compatible en directorio/puertos separados, solo loopback, sin conectarla a la WebApp ni permitir envíos SMTP/webhooks/cobros. Alternativa: proyecto temporal privado de recuperación, distinto de kqfphrukxdvlrbjipjnx, con acceso restringido; requiere aprobar costo y copia de datos reales. No crearlo ahora.
No contaminar staging sintético ni restaurar sobre producción.

1. Crear fuera del repo y OneDrive una carpeta exclusiva en disco cifrado, restringida al operador y a la cuenta de recuperación autorizada. Proteger herencia/ACL; no usar Documents sincronizado. No mostrar/exportar contraseña al chat.
2. Inventariar extensiones, customizaciones Auth/Storage, Vault/cifrado, publicaciones Realtime, funciones/RLS/grants y datos. Exportar manifest de conteos/definiciones del snapshot; coordinar coherencia entre momento del dump y baseline si hay escrituras activas. No considerar una diferencia temporal una corrupción sin investigar.
3. Supabase > proyecto productivo > Connect > Session pooler (o Direct si red IPv6 compatible). Usar contraseña existente de DB; no resetearla. Esto NO es service_role. El operador introduce la conexión en sesión privada, sin comandos literales con contraseña ni logs debug.
4. Ejemplo de comandos en PowerShell 7, dentro de carpeta protegida ya seleccionada. NO ejecutados:

~~~powershell
supabase --version
supabase db dump --help
$giftBackupConnection = Read-Host 'Conexión DB productiva completa (no compartir)' -MaskInput
try {
  supabase db dump --db-url $giftBackupConnection --role-only -f roles.sql
  if ($LASTEXITCODE -ne 0) { throw 'Backup roles falló' }
  supabase db dump --db-url $giftBackupConnection -f schema.sql
  if ($LASTEXITCODE -ne 0) { throw 'Backup esquema falló' }
  supabase db dump --db-url $giftBackupConnection --data-only --use-copy -f data.sql
  if ($LASTEXITCODE -ne 0) { throw 'Backup datos falló' }
  supabase db dump --db-url $giftBackupConnection --schema supabase_migrations -f history_schema.sql
  if ($LASTEXITCODE -ne 0) { throw 'Backup historial esquema falló' }
  supabase db dump --db-url $giftBackupConnection --schema supabase_migrations --data-only --use-copy -f history_data.sql
  if ($LASTEXITCODE -ne 0) { throw 'Backup historial datos falló' }
  Get-FileHash roles.sql,schema.sql,data.sql,history_schema.sql,history_data.sql -Algorithm SHA256
} finally { Remove-Variable giftBackupConnection -ErrorAction SilentlyContinue }
~~~

No copiar la URI a historial, transcript o debug. La variable no aparece en el historial como literal, pero puede pasar como argumento al proceso: ejecutar en equipo privado, sin compartir procesos/logs. Si se necesita evitar esa exposición local, preparar mecanismo de credenciales de cliente adecuado antes de correr.
Si existen tablas storage.buckets_vectors/storage.vector_indexes, aplicar las exclusiones de la guía oficial únicamente tras inventariarlas y documentar cómo recuperar su contenido. No excluir datos desconocidos silenciosamente.
Formato recomendado: SQL lógico separado (roles/schema/data/historial), compatible con herramientas Supabase, acompañado de manifest y SHA-256; cifrar todo el conjunto con herramienta aprobada. Hash verifica integridad, no confidencialidad ni restaurabilidad.
No publicar SQL de datos ni hashes de credenciales. Hashes de archivos completos se conservan en manifest protegido.
Los objetos de Storage, configuración Auth/SMTP/OAuth, claves de firma/API, funciones externas y Netlify Blobs no se recuperan únicamente con el dump: respaldo/recuperación independiente.
Auth/users: contiene PII y hashes de contraseña; verificar que data.sql incluye usuarios y relaciones necesarias sin imprimir filas. Mantener UUID para FKs staff/performed_by. Customizaciones de esquemas administrados requieren captura aparte; no recrear ciegamente todo Auth/Storage de otra versión.
No se conservan mágicamente sesiones válidas/API keys/JWT en proyecto nuevo. Preferir no habilitar Auth/SMTP externo en ensayo. Roles LOGIN personalizados pueden requerir nuevas contraseñas en destino seguro.
Vault/cifrado: si existen datos cifrados, faltan claves externas de recuperación hasta verificarlas privadamente. Un restore con ciphertext pero sin clave utilizable NO es PASS.
Fuente oficial: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

## Restore aislado (no ejecutado)
- Aprobar destino vacío y restringido, versión/extensiones y espacio. Identificar host/ref diferente de producción Y del staging actual. Detenerse si no puede demostrarse.
- Preparar plataforma Supabase compatible y customizaciones/roles necesarios; no desactivar seguridad en producción.
- Para un destino sin Vault/cifrado, comando ilustrativo (solo destino de recuperación):
~~~powershell
$giftRestoreConnection = Read-Host 'Conexión DESTINO NO PRODUCTIVO (no compartir)' -MaskInput
try {
  psql --dbname $giftRestoreConnection --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command 'SET session_replication_role = replica' --file data.sql
  if ($LASTEXITCODE -ne 0) { throw 'Restore falló; NO declarar recuperable' }
  psql --dbname $giftRestoreConnection --single-transaction --variable ON_ERROR_STOP=1 --file history_schema.sql --file history_data.sql
  if ($LASTEXITCODE -ne 0) { throw 'Restore historial falló' }
} finally { Remove-Variable giftRestoreConnection -ErrorAction SilentlyContinue }
~~~
La URI se valida privadamente antes de comando, no se proporcionó ni ejecutó aquí. Con Vault/cifrado usar flujo oficial apropiado; no omitir recuperación de claves.
Revisar triggers/customizaciones administradas antes de desactivarlos en sesión de restore; restauración no prueba por sí sola su funcionamiento normal. Revalidar triggers, RLS, grants y publicaciones tras carga. No importar encima de otro dataset.
Criterios BACKUP RECUPERABLE = PASS:
1. Exit codes cero, archivos no vacíos, hashes coincidentes y copia cifrada accesible.
2. Restore completo sin errores ignorados en destino correcto.
3. Conteos de Gift Cards/movimientos/orders/order_items/staff_profiles y tablas relacionadas coinciden con manifest del dump.
4. Mismos saldos y cuadre financiero; 0 huérfanos; UUID Auth necesarios preservados.
5. Sequences, definiciones RPC/trigger/view, RLS/policies/grants y referencias comprobadas.
6. Pruebas de permisos/funciones en destino aislado con usuarios sintéticos, sin enviar mensajes/cargos reales.
7. Limitaciones de Storage/Blobs/Auth/Vault enumeradas y cubiertas para recuperación del servicio.
8. Acta de ensayo: fecha, versiones, operador, destino, hashes y procedimiento; recuperación repetible.
Un dump sin ensayo sigue PENDING. El baseline anterior 2/5/52/6 es histórico; no asumir que sea el snapshot de un backup futuro.

## Certificación manual Netlify — DETENERSE aquí
Menú: Netlify > pedidos-theblackcat > Project configuration > Environment variables.
Expandir SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CULQI_SECRET_KEY. Revisar fila Production y scopes Functions; no editar ni quitar marca Secret.
Netlify write-only: incluso UI/CLI/API no permiten recuperar secretos ya marcados. La presencia, suffix o un valor del proveedor NO demuestran por sí solos qué recibió el runtime.
Usar registro privado/vault original de configuración para atestar procedencia: SUPABASE_URL hostname hhqcshtzhzzgibmhvuue.supabase.co; service_role creada en ese mismo proyecto; CULQI_SECRET_KEY sk_live_ del mismo comercio de la pk_live_.
No afirmar que leer project keys de Supabase acredita el valor oculto instalado en Netlify.
Responder únicamente:
- Tengo/no tengo registro fiable de los valores configurados en Production.
- Backend Supabase productivo y service_role del mismo proyecto: verificado/no verificable.
- Backend Culqi sk_live_ y mismo comercio: verificado/no verificable.
Sin originales/registro, queda PENDING: requeriría un método de certificación runtime aprobado por separado o reconfiguración controlada autorizada. No desplegar diagnóstico productivo ni cambiar variables ahora.
Fuente: https://docs.netlify.com/build/environment-variables/secrets-controller/

## Culqi manual — sin crear ni probar pagos
1. Iniciar sesión personalmente en CulqiPanel y seleccionar el comercio correcto.
2. Seleccionar/verificar Producción/LIVE; revisar llaves de producción sin compartir valores: pk_live_ y sk_live_ del mismo comercio, no integración TEST.
3. Abrir Eventos > Webhooks (seguir el nombre real visible en panel).
4. Inventariar TODOS los endpoints/eventos en LIVE y duplicados del sistema.
5. Confirmar si existe exactamente https://theblackcatrockbar.com/.netlify/functions/culqi-webhook con order.status.changed.
6. Anotar si figura activa la autenticación y su tipo; no publicar credenciales de autenticación, ni activar/desactivar opciones. El handler actual no verifica una firma entrante adicional: verifica estado con API autenticada de Culqi; cualquier autenticación configurada necesita evaluación de compatibilidad.
7. Inspeccionar TEST por separado: debe apuntar a staging, nunca confundirlo con LIVE.
Responder modo/comercio confirmado, existencia/cantidad, URL/evento, duplicados y tipo de autenticación sin secretos. NO pulsar Añadir/Registrar/Enviar prueba ni editar.
Fuente: https://docs.culqi.com/es/documentacion/pagos-online/webhooks/

## Suspensión mínima propuesta — requiere aprobación antes de implementar
No existe flag específico. Cocina cerrada no sirve: afectaría pedidos normales y no cubre compra pública Gift Card.
Propuesta: fila protegida app_settings key gift_card_operations con booleanos gift_card_sales_enabled y gift_card_redemption_enabled, updated_at/updated_by; ambos false inicialmente. Tabla existente, NO recrearla.
Leer estado en backend sin cache larga; missing/invalid/error falla cerrado para NUEVAS operaciones, no para consulta/conciliación.
Cambios acotados de RLS/RPC/grants: solo admin/manager activo modifica esa clave; público no escribe; no ampliar políticas de kitchen_status. Acceso al servicio mediante backend y permisos explícitos.
Sales false: impedir crear nueva compra y nuevo cargo de compra, pero permitir consultar/finalizar/verificar compras con pago ya demostrado.
Redemption false: impedir NUEVA reserva, nuevo intento mixto/cargo complementario y nuevo canje presencial. Gates antes de crear pedido/reservar/hacer POST externo. Sin afectar pagos normales sin Gift Card.
RPC de canje presencial y reserva necesitan protección también: bloquear solo frontend/Netlify no cubre acceso authenticated directo a redeem_gift_card.
NO bloquear apply/finalize de operaciones ya pagadas, webhook, status, conciliación manual o consultas. No liberar reservas como efecto de apagar flags.
Switch no deshace operaciones ya en vuelo ni impide que Culqi acepte una orden externa ya emitida; esos resultados se siguen conciliando. Delimitar corte por intento auditado, no prometer cancelación instantánea.
Probar flags y carreras en staging antes de usar; nueva migración independiente si cambia RPC/RLS, sin reescribir las seis auditadas. Registrar actor, fecha y estado del cambio sin alterar auditoría financiera.
No se implementó ni aplicó esta propuesta.

## Runbook de incidente
| Escenario | Suspender | Preservar/resolver | Deploy y SQL |
| --- | --- | --- | --- |
| Frontend falla, backend estable | Nuevas operaciones mediante flags aprobados | Backend de consultas/webhook/conciliación y datos | Revertir solo frontend si puede hacerse manteniendo Functions válidas; deploy atómico requiere candidato específico, no asumir split |
| Functions fallan | Ventas/canjes NUEVOS, no callbacks | Intentos/reservas/referencias/logs; identificar punto antes/después POST | Usar versión backend segura compatible con DB. No rollback genérico que quite protección de incertidumbre |
| Webhook falla | Nuevas operaciones financieras para limitar backlog | Conservar eventos/retries; consultar Culqi por GET, conciliar con monto/PEN/checkout; no aplicar por payload solo | Reparar compatibilidad y reintentar eventos existentes; no cargos nuevos ni borrar webhook/datos |
| reconciliation_required | Nuevo intento del checkout afectado; suspender globalmente si crece | Retener saldo reservado, evidencia y actor/nota; GET ambiguo no aprueba; conciliación manual auditada | No release por >90min; no rollback SQL para limpiar estados |
| Migración falla antes de LIVE | No abrir Phase 2 ni seguir al próximo checkpoint | ROLLBACK de la transacción fallida; snapshot y definiciones previas | Preferir conservar DDL aditivo ya exitoso; restaurar RPC/grants sólo con plan y sin reservas |
| Compra/canje LIVE ya existe | Nuevas operaciones, manteniendo resolución de pendientes | Conservar tablas/auditoría/códigos/Blobs; conciliar cargos/canjes/devoluciones | NO DROP ni restore ciego; NO redeem viejo que ignore reservas; restaurar código sólo si preserva callbacks y protección |

Tras cada intervención: saldo no negativo, canje/pedido/cargo únicos, reservas coherentes, ningún paid sin movimiento esperado ni canje sin paid/devolución auditada. Logs y monitoreo por referencias sanitizadas, nunca secretos/PII.
Con flags todavía no implementados, la suspensión de la tabla anterior es un procedimiento objetivo, NO una capacidad ya disponible.

## Checkpoints futuros y monitoreo
Autorización -> backup ensayado -> certificación privada -> candidato con suspensión validada -> snapshot -> 00005/06/07/08/09/20261001000000 uno por uno -> variables verificadas -> deploy -> webhook -> autorización aparte smoke LIVE -> monitoreo.
STOP: backup no probado, mezcla/entorno no certificable, drift SQL, locks/error, RLS incorrecta, Functions/webhook no saludables, doble cargo/canje o saldo/reserva incorrecto.
Vigilar reconciliation_required, processing >10min, reservas >90min, duplicados, saldos negativos, pedidos paid sin redemption y viceversa (con gracia de sincronización y devoluciones), errores webhook/Culqi. Nunca liberar por edad.
Sin dinero real también una creación administrativa ESCRIBE: requiere autorización y datos controlados. Smoke LIVE requiere aprobación expresa antes de cargo mínimo S/50, canje total y mixto pequeño.

## Matriz de prerrequisitos
- Paquete limpio: candidato local preparado; validación de alcance/hash/lint/build requerida antes de commit; no publicado.
- Backup creado: PENDING.
- Restore ensayado: PENDING.
- Supabase backend certificado: PENDING.
- Culqi LIVE certificado: PENDING.
- Webhook LIVE: PENDING.
- Suspensión segura: PENDING (propuesta).
- Runbook: preparado, no ensayado con flags aún.
Resultado: NOT READY FOR FINAL PREFLIGHT.
