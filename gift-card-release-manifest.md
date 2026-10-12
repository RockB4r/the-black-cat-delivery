# Manifest del candidato local Gift Cards Phase 2
Fecha: 2026-10-12. No autorizada publicación.
Base exacta: 33dc0b86ec5f164d01a0f9257e823007e33de433 (main).
Fuente validada: 01f127cadc24fd2c953e2c7aeaaa03b0b5b12abe (staging).
Rama: gift-cards-phase2-release. Checkout separado; staging se conserva intacto.
Estrategia: commit consolidado reproducible desde main con lista A/B. No cherry-pick ciego de commits mezclados ni arrastre de endpoints temporales.
45 archivos seleccionados (27 A, 18 B), más este manifest y runbook operativo. Las pruebas/fixtures excluidos permanecen en staging como evidencia de validación, no se ejecutan ni se instalan en producción. Los tests preexistentes en main no se borran.
PASS de alcance no implica autorización de rollout: falta suspensión aprobada/implementada, backup restaurado y certificación privada de variables/Culqi.

## Clasificación de commits
| Commit | Asunto | Clasificación y decisión |
| --- | --- | --- |
| 8e8e421 | test: gift cards phase 2 staging | A/B/C/D (mixto, incorporación parcial) |
| 574cfbc | fix: handle empty Supabase responses in gift card flow | A/B (incorporación parcial sin fixtures) |
| e52acce | fix: keep gift card checkout intent consistent across retries | A/B (incorporación parcial sin fixtures) |
| 4d836b8 | fix: use valid Culqi order numbers for gift cards | A/B (incorporación parcial sin fixtures) |
| 0a8cbde | test: add temporary staging Culqi charge diagnostic | D (excluir) |
| 2258424 | fix: avoid secret-scanner match in staging diagnostic | D (excluir) |
| 2def703 | fix: expose sanitized Culqi diagnostic error in staging | D (excluir) |
| 28a4454 | fix: query approved Culqi test charge in staging diagnostic | D (excluir) |
| 7d13bde | fix: verify Culqi gift card charges with nullable status | A/D (solo resultado final, sin diagnóstico) |
| bf610f3 | fix: normalize Gift Card payment codes in staging | A/B (incorporación parcial sin fixtures) |
| 9486f4b | fix: clarify gift card payment codes in staging | A/B (incorporación parcial sin fixtures) |
| 18805be | fix: protect uncertain mixed Gift Card payments | A/B (incorporación parcial sin fixtures) |
| 4d84b42 | Update member welcome email hero | C (excluir; main ya conserva su imagen) |
| 01f127c | fix: harden Culqi environment validation and live readiness | A/B (incorporación parcial sin fixtures) |

## Clasificación de cada archivo de diferencia neta
A: funcionalidad Gift Cards y sus migraciones/documentación. B: integración indispensable (checkout, cocina, fiscalidad, rechazo/devolución, RPC baseline, herramientas). C: ajeno. D: pruebas/fixtures/referencias retiradas, no paquete productivo.
| Archivo | Clase | Acción |
| --- | --- | --- |
| gift-card-live-readiness.md | A | Conservar estado final validado |
| netlify/functions/create-culqi-charge.ts | B | Conservar estado final validado |
| netlify/functions/create-culqi-order.ts | B | Conservar estado final validado |
| netlify/functions/culqi-config.ts | B | Conservar estado final validado |
| netlify/functions/culqi-webhook.ts | B | Conservar estado final validado |
| netlify/functions/gift-card-charge.ts | A | Conservar estado final validado |
| netlify/functions/gift-card-public.ts | A | Conservar estado final validado |
| netlify/functions/gift-card-purchase-status.ts | A | Conservar estado final validado |
| netlify/functions/gift-card-purchase.ts | A | Conservar estado final validado |
| netlify/functions/gift-card-quote.ts | A | Conservar estado final validado |
| netlify/functions/gift-card-reconcile.ts | A | Conservar estado final validado |
| netlify/functions/reject-kitchen-order.ts | B | Conservar estado final validado |
| netlify/lib/culqi-verification.ts | B | Conservar estado final validado |
| netlify/lib/gift-cards.ts | A | Conservar estado final validado |
| netlify/lib/member-promotions.ts | C | Excluir delta; conservar baseline main si existía |
| netlify/lib/orders.ts | B | Conservar estado final validado |
| netlify/lib/request.ts | B | Conservar estado final validado |
| public/branding/hell10-member-email-hero.png | C | Excluir delta; conservar baseline main si existía |
| public/branding/member-vip-email-hero.png | C | Excluir delta; conservar baseline main si existía |
| public/branding/thursday-draft-beer-5x4-flyer.png | C | Excluir delta; conservar baseline main si existía |
| src/AdminOrdersPortal.tsx | B | Conservar estado final validado |
| src/App.css | B | Conservar estado final validado |
| src/App.tsx | B | Conservar estado final validado |
| src/GiftCardPage.css | A | Conservar estado final validado |
| src/GiftCardPage.tsx | A | Conservar estado final validado |
| src/GiftCardPurchase.tsx | A | Conservar estado final validado |
| src/GiftCardsPublic.css | A | Conservar estado final validado |
| src/KitchenDisplay.tsx | B | Conservar estado final validado |
| src/giftCardCheckout.ts | A | Conservar estado final validado |
| src/lib/culqiEnvironment.ts | B | Conservar estado final validado |
| src/lib/giftPaymentCode.ts | A | Conservar estado final validado |
| src/main.tsx | B | Conservar estado final validado |
| src/staff/GiftCardsPanel.tsx | A | Conservar estado final validado |
| supabase/migration-reference/20260922000004_gift_cards_phase2.sql | D | Excluir delta; conservar baseline main si existía |
| supabase/migration-reference/README.md | B | Conservar estado final validado |
| supabase/migration-reference/create_kitchen_order_with_items_before_phase2.sql | B | Conservar estado final validado |
| supabase/migration-reference/phase2-rollout.md | B | Conservar estado final validado |
| supabase/migrations/20260922000005_gift_cards_phase2_a_structure.rollback.md | A | Conservar estado final validado |
| supabase/migrations/20260922000005_gift_cards_phase2_a_structure.sql | A | Conservar estado final validado |
| supabase/migrations/20260922000006_gift_cards_phase2_a_backfill.rollback.md | A | Conservar estado final validado |
| supabase/migrations/20260922000006_gift_cards_phase2_a_backfill.sql | A | Conservar estado final validado |
| supabase/migrations/20260922000007_gift_cards_phase2_b_rpcs.rollback.md | A | Conservar estado final validado |
| supabase/migrations/20260922000007_gift_cards_phase2_b_rpcs.sql | A | Conservar estado final validado |
| supabase/migrations/20260922000008_gift_cards_phase2_c_phase1_functions.rollback.md | A | Conservar estado final validado |
| supabase/migrations/20260922000008_gift_cards_phase2_c_phase1_functions.sql | A | Conservar estado final validado |
| supabase/migrations/20260922000009_gift_cards_phase2_d_orders.rollback.md | A | Conservar estado final validado |
| supabase/migrations/20260922000009_gift_cards_phase2_d_orders.sql | A | Conservar estado final validado |
| supabase/migrations/20261001000000_gift_card_mixed_culqi_attempts.rollback.md | A | Conservar estado final validado |
| supabase/migrations/20261001000000_gift_card_mixed_culqi_attempts.sql | A | Conservar estado final validado |
| tests/culqi-live-readiness.test.mjs | D | Excluir delta; conservar baseline main si existía |
| tests/gift-card-checkout.test.mjs | D | Excluir delta; conservar baseline main si existía |
| tests/gift-card-culqi-verification.test.mjs | D | Excluir delta; conservar baseline main si existía |
| tests/gift-card-database.test.mjs | D | Excluir delta; conservar baseline main si existía |
| tests/gift-card-mixed-attempt.sql | D | Excluir delta; conservar baseline main si existía |
| tests/gift-card-mixed-attempt.test.mjs | D | Excluir delta; conservar baseline main si existía |
| tests/gift-card-phase2-roles.sql | D | Excluir delta; conservar baseline main si existía |
| tests/gift-card-phase2-static.test.mjs | D | Excluir delta; conservar baseline main si existía |
| tests/gift-card-phase2.sql | D | Excluir delta; conservar baseline main si existía |
| tests/gift-card-purchase.test.mjs | D | Excluir delta; conservar baseline main si existía |
| tests/gift-card-ux.test.mjs | D | Excluir delta; conservar baseline main si existía |
| tests/gift-payment-code.test.mjs | D | Excluir delta; conservar baseline main si existía |
| tsconfig.functions.json | B | Conservar estado final validado |

## Exclusiones adicionales (no tracked)
- supabase/staging_migrations/20260929000000_restore_kitchen_status_staging.sql
- supabase/staging_migrations/20261001000000_restore_product_availability_staging.sql
- Admin Staging, filas sintéticas y datos Culqi TEST: viven en servicios de staging, no se exportan.
- .env, credenciales, node_modules, dist y herramientas temporales: no incluir.
- 00004 no se encuentra en migraciones ejecutables ni en este release.

## Orden de seis migraciones auditadas
No modificar contenido ni ejecutar ahora. El hash SHA-256 del archivo auditado es:
| Archivo | SHA-256 |
| --- | --- |
| 20260922000005_gift_cards_phase2_a_structure.sql | 97E83A1268173F49791ACC8F9AF1B62E8E58BC0F7CF4FD5CAB38A7B6AD75FD65 |
| 20260922000006_gift_cards_phase2_a_backfill.sql | 588D78B8F6C920DF78CBBDDFB9584D2927578B1499C1199E4492CB2CD14D8D1B |
| 20260922000007_gift_cards_phase2_b_rpcs.sql | B265F444947A5D21895376DE5502BB99456576BA1885339CB7F83D2B4AACCA44 |
| 20260922000008_gift_cards_phase2_c_phase1_functions.sql | 1ED52B0DA7ECDB0D7C2804EE1660750E0C7556A72190C75AF75A1C79F38EB791 |
| 20260922000009_gift_cards_phase2_d_orders.sql | D97619C63BCD2B5D8E8FE66BBE31B45507671C6B299110ADFB35D374E963A0A1 |
| 20261001000000_gift_card_mixed_culqi_attempts.sql | 124BB763F14F562544ABBD566B1FD4F5B23743A83971687EA958585A4E48811D |

Comprobar además git hash-object de los 45 archivos seleccionados contra la fuente validada para detectar alteraciones y evitar diferencias de EOL accidentales.
Si se aprueba el control de suspensión, requiere cambios independientes, nueva migración si afecta RPC/RLS y otra validación staging. No reescribir estas seis.
