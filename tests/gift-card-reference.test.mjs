import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const panel = read('src/staff/GiftCardsPanel.tsx')
const ast = ts.createSourceFile('panel.tsx', panel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let handler
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'redeemCard') handler = node.initializer
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(handler, 'Use the actual frontend handler, not a duplicate implementation')
const handlerJs = ts.transpileModule(`const run = ${handler.getText(ast)}; run`, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
}).outputText

const execute = async (reference, confirm = true) => {
  const calls = [], history = [], messages = []
  let balance = 50
  const context = {
    selected: { id: 'synthetic-card', code: 'BC-GC-TEST', status: 'active', current_balance: 50, transferable: true },
    busy: false, consumptionAmount: '10', saleReference: reference, verifiedRecipient: '',
    statusOf: (card) => card.status, money: (value) => `S/ ${value}`,
    window: { confirm: () => confirm },
    setBusy() {}, setMessage(value) { messages.push(value) }, setRedemption() {},
    setConsumptionAmount() {}, setSaleReference() {}, async refreshSelected() {},
    supabase: { async rpc(name, args) {
      calls.push({ name, args })
      // In-memory boundary double: no network, database, or real balance writes.
      balance -= args.p_consumption_amount
      history.push({ reference: args.p_reference, consumption_channel: 'in_store' })
      return { data: { debited: 10, balance, remaining_to_pay: 0, idempotent: false }, error: null }
    } },
  }
  await runInNewContext(handlerJs, context)({ preventDefault() {} })
  return { calls, history, balance, messages }
}

for (const reference of ['Mesa 4 - Juan', '15414', 'BA01-00015414']) {
  test(`presencial: ${reference} reaches the unchanged RPC and history boundary intact`, async () => {
    const result = await execute(`  ${reference}  `)
    assert.equal(result.calls.length, 1)
    assert.equal(result.calls[0].name, 'redeem_gift_card')
    assert.equal(result.calls[0].args.p_reference, reference)
    assert.equal(result.calls[0].args.p_consumption_amount, 10)
    assert.deepEqual(result.history, [{ reference, consumption_channel: 'in_store' }])
    assert.equal(result.balance, 40)
  })
}

test('cancel confirmation: no RPC, movement or balance change', async () => {
  const result = await execute('Mesa 4 - Juan', false)
  assert.equal(result.calls.length, 0)
  assert.equal(result.history.length, 0)
  assert.equal(result.balance, 50)
})

test('empty reference still rejected before the RPC', async () => {
  const result = await execute('   ')
  assert.equal(result.calls.length, 0)
  assert.equal(result.balance, 50)
  assert.match(result.messages[0], /referencia de cuenta \/ venta/)
})

test('UI retains required reference and length limit but does not require a receipt', () => {
  assert.match(panel, /<h3>Canje presencial<\/h3>/)
  const labelStart = panel.indexOf('<label>Referencia de cuenta / venta')
  assert.ok(labelStart >= 0)
  const label = panel.slice(labelStart, panel.indexOf('</label>', labelStart))
  assert.match(label, /maxLength=\{120\}/)
  assert.match(label, /required/)
  assert.match(panel, /No es necesario que el comprobante exista antes del canje/)
  assert.doesNotMatch(panel, /Primero registra el consumo completo en Caja|referencia de la venta registrada en Caja/)
})

test('history reads existing channels/order link, without rewriting old records', () => {
  assert.match(panel, /select\('id, movement_type, amount, balance_before, balance_after, reference, consumption_channel, order_id, created_at'\)/)
  assert.match(panel, /Canal:.*item\.consumption_channel === 'online' \? 'Online' : 'Presencial'/)
  assert.match(panel, /Referencia automática/)
  assert.match(panel, /Pedido online: \{item\.order_id\}/)
  assert.doesNotMatch(panel, /from\('gift_card_transactions'\)\.(update|insert|delete)/)
})

test('existing SQL accepts free text and persists the manual reference with actor/channel', () => {
  const sql = read('supabase/migrations/20260922000008_gift_cards_phase2_c_phase1_functions.sql')
  assert.match(sql, /nullif\(btrim\(p_reference\),''\) is null or length\(p_reference\)>120/)
  assert.match(sql, /p_reference,auth\.uid\(\),'in_store'/)
  assert.match(sql, /movement_type='redemption' and reference=p_reference/)
})

test('online references and idempotency remain automatic, not customer-supplied', () => {
  const checkout = read('src/App.tsx')
  const backend = read('netlify/functions/create-culqi-order.ts')
  const sql = read('supabase/migrations/20260922000007_gift_cards_phase2_b_rpcs.sql')
  assert.match(checkout, /checkoutIdRef\.current \?\? crypto\.randomUUID\(\)/)
  assert.doesNotMatch(checkout, /saleReference|Referencia de cuenta|Referencia de venta de Caja|p_reference/)
  assert.match(backend, /reserveGiftForOrder\(order\.databaseOrderId, order\.checkoutId, giftPaymentCode, order\.customer\)/)
  assert.match(sql, /v_order\.order_number,'online',p_order_id,[\s\S]*'online_order:' \|\| p_order_id::text/)
  assert.match(sql, /if v_payment\.status='applied' then[\s\S]*'idempotent',true/)
})
