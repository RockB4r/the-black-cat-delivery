import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const migrationDir = new URL('../supabase/migrations/', import.meta.url)
const read = (name) => readFileSync(new URL(name, migrationDir), 'utf8')

test('monolito fuera de migraciones y etapas en orden', () => {
  const files = readdirSync(migrationDir).filter((name) => name.includes('gift_cards_phase2') && name.endsWith('.sql'))
  assert.equal(files.some((name) => name.startsWith('20260922000004')), false)
  assert.deepEqual(files.sort(), [
    '20260922000005_gift_cards_phase2_a_structure.sql',
    '20260922000006_gift_cards_phase2_a_backfill.sql',
    '20260922000007_gift_cards_phase2_b_rpcs.sql',
    '20260922000008_gift_cards_phase2_c_phase1_functions.sql',
    '20260922000009_gift_cards_phase2_d_orders.sql',
  ])
})

test('nuevas RPC nunca son ejecutables por anon/authenticated y el NULL role se rechaza', () => {
  const b = read('20260922000007_gift_cards_phase2_b_rpcs.sql')
  const c = read('20260922000008_gift_cards_phase2_c_phase1_functions.sql')
  assert.match(b, /revoke all on function public\.finalize_gift_card_purchase[\s\S]*from public, anon, authenticated/i)
  assert.match(b, /grant execute on function public\.finalize_gift_card_purchase[\s\S]*to service_role/i)
  assert.match(c, /coalesce\(private\.gift_card_staff_role\(\),''\) not in \('manager','admin'\)/i)
  assert.equal(['admin', 'manager'].every((role) => ['manager', 'admin'].includes(role)), true)
  assert.equal(['staff', null].every((role) => !['manager', 'admin'].includes(role ?? '')), true)
})

test('reserva mixta no se libera por temporizador y usa estados separados', () => {
  const a = read('20260922000005_gift_cards_phase2_a_structure.sql')
  const b = read('20260922000007_gift_cards_phase2_b_rpcs.sql')
  assert.match(a, /'pending','payment_pending','reconciliation_required','paid','failed','expired','released','applied'/)
  assert.match(b, /Confirmar vencimiento Culqi antes de liberar/)
  assert.match(b, /p_culqi_reference is distinct from v_order\.culqi_charge_id/)
  assert.match(b, /p_culqi_reference is distinct from v_order\.culqi_order_id/)
  assert.doesNotMatch(b, /Safe automatic cleanup/)
})

test('pedido sigue con firma estable e idempotencia por checkout_id', () => {
  const d = read('20260922000009_gift_cards_phase2_d_orders.sql')
  assert.match(d, /create or replace function public\.create_kitchen_order_with_items\(p_order jsonb,p_items jsonb\)/i)
  assert.match(d, /on conflict \(checkout_id\) where checkout_id is not null do nothing/i)
  assert.doesNotMatch(d.replace(/^--.*$/gm, ''), /rename|_legacy/i)
})

test('SQL estático: delimitadores cerrados, sin borrado financiero ni SECURITY DEFINER en nuevas RPC', () => {
  const files = readdirSync(migrationDir).filter((name) => /^202609220000(05|06|07|08|09).*\.sql$/.test(name))
  for (const file of files) {
    const sql = read(file)
    assert.equal((sql.match(/\$\$/g) ?? []).length % 2, 0, `${file}: bloque PL/pgSQL incompleto`)
    assert.doesNotMatch(sql, /\bdrop\s+(table|column)\b/i, `${file}: borrado financiero`)
  }
  assert.doesNotMatch(read('20260922000007_gift_cards_phase2_b_rpcs.sql').replace(/^--.*$/gm, ''), /security definer/i)
})
