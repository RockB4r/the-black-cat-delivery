# Resolución de los dos bloqueantes — 2026-10-13

Esta actualización sustituye el FAIL anterior de parsing/exclusión de fixtures. No autoriza rollout, merge main, migraciones, webhook LIVE, variables productivas ni dinero LIVE.

## Runtime

`netlify/functions/culqi-webhook.ts:13–25`: envelope no-array; evento con type informado debe ser order.status.changed. data objeto se usa directamente; data string pasa por JSON.parse, nunca eval. Error/empty/null/array/primitivo -> 400 antes del GET o cualquier mutación. No fallback al ID evt cuando existe data inválido. Se conserva el payload directo de orden legacy. ID/entorno sigue siendo obligatorio.

No se cambia la arquitectura financiera: GET autenticado a Culqi backend, validación de orden/monto/PEN/estado, locks/idempotencia/attempts/reservas y conciliación. No credenciales nuevas ni claves frontend.

## Pruebas y clasificación

TEST NECESARIO PERO NO PRODUCTIVO: tests/culqi-webhook-payload.test.mjs nuevo, únicamente staging. Handler real con dependencias/HTTP inyectados. 18 subcasos + test contenedor: objeto/string equivalentes, JSON inválido, empty/null/array/primitivo/missing/wrong ID, ambos cruces TEST/LIVE, evento distinto, duplicado y payload atrasado, resolución reconciliation_required, expiración con incertidumbre, monto proveedor distinto y formato legacy.

Toda la suite staging: 107 tests PASS. Lint, build y typecheck específico Gift Cards/webhook PASS en staging y release. Corepack no pudo consultar npm por DNS; se ejecutaron los mismos binarios instalados de oxlint, tsc y vite, sin instalar/cambiar dependencias. Warning bundle >500KB y API experimental stripTypeScriptTypes de Node no bloqueantes.

ELIMINAR DEL RELEASE (conservados idénticos en staging, normalizando solo CRLF):

- tests/export-members-xlsx.test.mjs
- tests/export-members.test.mjs
- tests/gift-card-operations.sql
- tests/gift-card-operations.test.mjs
- tests/gift-card-permissions.test.mjs
- tests/gift-card-presentation.test.mjs
- tests/gift-card-unblock.sql

El criterio final exige no tests en el árbol candidato: se retiran también los heredados de main, sin eliminarlos en staging ni reescribir historial Git. RUNTIME NECESARIO: soporte test/live en validadores conservado; no constituye datos sintéticos. DOCUMENTACIÓN necesaria: manifest, runbook y este informe. Ningún archivo temporal, fixture o endpoint diagnóstico se añade al candidato.

## Siete migraciones intactas — SHA-256

```text
20260922000005 97E83A1268173F49791ACC8F9AF1B62E8E58BC0F7CF4FD5CAB38A7B6AD75FD65
20260922000006 588D78B8F6C920DF78CBBDDFB9584D2927578B1499C1199E4492CB2CD14D8D1B
20260922000007 B265F444947A5D21895376DE5502BB99456576BA1885339CB7F83D2B4AACCA44
20260922000008 1ED52B0DA7ECDB0D7C2804EE1660750E0C7556A72190C75AF75A1C79F38EB791
20260922000009 D97619C63BCD2B5D8E8FE66BBE31B45507671C6B299110ADFB35D374E963A0A1
20261001000000 124BB763F14F562544ABBD566B1FD4F5B23743A83971687EA958585A4E48811D
20261013195353 AEAACA67B57C6381D058D688940E3B9EDB1234A1DD71D0426C24433DEE40428C
```

Orden no cambia. No SQL/RPC/esquema/flags/permisos ni datos alterados; no regresión SQL adicional necesaria para un parser. Pruebas financieras existentes de staging conservadas.

## Nuevo veredicto de preparación: PASS WITH CONDITIONS

Ambos bloqueantes de código/árbol candidato quedan resueltos. Los pasos operativos pendientes no se ejecutan aquí: autorización rollout, backup FINAL/snapshot coherentes, siete migraciones por checkpoint, verificación runtime LIVE, deploy aprobado, único webhook LIVE, smoke sin dinero, aprobación separada para primer pago y habilitación gradual con vigilancia. Backup/restore/certificación/suspensión mantienen su checkpoint previo; no se repitieron lecturas productivas ni se presume validada entrega LIVE sin evento real.

El monitoreo y rollback seguros del preflight anterior siguen vigentes: OFF cierra admisión, no callbacks; no quitar guards ni borrar intentos/estructuras después de movimientos. El historial staging de mixed attempts requiere trazabilidad explícita, no db push.

Podemos solicitar autorización para iniciar el rollout controlado a producción.
