# A2 — rollback funcional

El backfill genera códigos de pago para tarjetas existentes sin alterar su procedencia ni saldo. No borrar ni regenerar esos códigos: podrían haberse entregado a clientes. Para desactivar pagos en línea, retirar las Functions/UI Phase 2; mantener los códigos como dato histórico. Si A2 falla, la transacción de migración debe revertirse completa antes de avanzar a B.

Validar: número de códigos nulos y duplicados, y que Fase 1 aún funciona. No hay rollback destructivo automático.
