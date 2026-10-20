import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { verifyCulqiNoCharge, terminalCulqiOrderForNoCharge } from '../netlify/lib/culqi-no-charge.ts'
import { getCulqiEnvironment, validateCulqiOrderId } from '../netlify/lib/culqi-verification.ts'

const expected = { id: 'ord_test_fixture', orderNumber: 'STG-MIX-1', amountInCents: 1000,
  checkoutId: '11111111-1111-4111-8111-111111111111', databaseOrderId: '22222222-2222-4222-8222-222222222222',
  attemptIds: ['33333333-3333-4333-8333-333333333333'], since: '2026-01-01T00:00:00Z' }
const order = { id: expected.id, order_number: expected.orderNumber, amount: 1000, currency_code: 'PEN', state: 'deleted', paid_at: 1792376327 }
const charge = { id: 'chr_test_fixture', amount: 1000, currency_code: 'PEN', description: `Pedido ${expected.orderNumber}`,
  paid: false, outcome: { type: 'operacion_denegada', code: 'DNGE0003' },
  metadata: { checkout_id: expected.checkoutId, attempt_id: expected.attemptIds[0] } }

async function evidence(run, externalOrder = order, charges = [charge], status = 200) {
  const oldFetch = globalThis.fetch, oldSecret = process.env.CULQI_SECRET_KEY
  process.env.CULQI_SECRET_KEY = 'sk_test_SYNTHETIC'
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    assert.ok(!init.method || init.method === 'GET', 'evidence must be read-only')
    calls.push(String(url))
    return String(url).includes('/v2/orders/') ? Response.json(externalOrder)
      : Response.json({ data: charges }, { status })
  }
  try { return await run(calls) } finally {
    globalThis.fetch = oldFetch
    if (oldSecret === undefined) delete process.env.CULQI_SECRET_KEY; else process.env.CULQI_SECRET_KEY = oldSecret
  }
}

for (const state of ['deleted', 'expired']) test(`${state} + rejected paid=false charge permits manual no-charge evidence`, async () => {
  await evidence(async () => assert.equal(await verifyCulqiNoCharge('sk_test_SYNTHETIC', expected), true), { ...order, state })
})
test('deleted alone is insufficient: paid_at anomaly never bypasses charge verification', async () => {
  await evidence(async calls => {
    assert.equal(terminalCulqiOrderForNoCharge(order, expected), true)
    assert.equal(await verifyCulqiNoCharge('sk_test_SYNTHETIC', expected), false)
    assert.equal(calls.length, 2)
  }, order, [{ ...charge, paid: true, outcome: { type: 'venta_exitosa' } }])
})
for (const state of ['pending', 'paid', 'created', 'unknown']) test(`external order ${state} cannot clear`, async () => {
  await evidence(async calls => {
    assert.equal(await verifyCulqiNoCharge('sk_test_SYNTHETIC', expected), false)
    assert.equal(calls.length, 1)
  }, { ...order, state })
})
for (const change of [{ amount: 999 }, { currency_code: 'USD' }, { id: 'ord_live_other' },
  { order_number: 'other' }, { metadata: { checkout_id: 'other' } }, { paid: true }]) {
  test(`external order mismatch ${JSON.stringify(change)} rejects`, async () => {
    await evidence(async () => assert.equal(await verifyCulqiNoCharge('sk_test_SYNTHETIC', expected), false), { ...order, ...change })
  })
}
for (const change of [{ paid: true }, { paid: null }, { outcome: { type: 'venta_exitosa' } }, { outcome: null },
  { amount: 999 }, { currency_code: 'USD' }, { currency: 'USD' }, { id: 'chr_live_other' },
  { description: 'wrong' }, { metadata: { checkout_id: 'other' } }, { metadata: { attempt_id: 'other' } },
  { state: 'Exitosa' }, { response_code: 'venta_exitosa' }]) {
  test(`associated charge mismatch/ambiguity ${JSON.stringify(change)} rejects`, async () => {
    await evidence(async () => assert.equal(await verifyCulqiNoCharge('sk_test_SYNTHETIC', expected), false), order, [{ ...charge, ...change }])
  })
}
test('second approved charge blocks clearing', async () => {
  await evidence(async () => assert.equal(await verifyCulqiNoCharge('sk_test_SYNTHETIC', expected), false), order,
    [charge, { ...charge, id: 'chr_test_second', paid: true, outcome: { type: 'venta_exitosa' } }])
})
test('provider HTTP failure does not prove no charge', async () => {
  await evidence(async () => assert.equal(await verifyCulqiNoCharge('sk_test_SYNTHETIC', expected), false), order, [], 500)
})
test('unidentifiable charge and missing pagination evidence fail closed', async () => {
  await evidence(async () => assert.equal(await verifyCulqiNoCharge('sk_test_SYNTHETIC', expected), false), order,
    [{ ...charge, description: null, metadata: null }])
})
for (const approvedOnSecondPage of [false, true]) test(`all charge pages must be verified; approved on page two=${approvedOnSecondPage}`, async () => {
  await evidence(async () => {
    const mock = globalThis.fetch
    let pages = 0
    globalThis.fetch = async (url, init) => {
      if (!String(url).includes('/v2/charges?')) return mock(url, init)
      pages++
      if (pages === 1) return Response.json({ data: Array.from({ length: 100 }, (_, index) => ({ ...charge, id: `chr_test_page${index}` })) })
      assert.match(String(url), /after=chr_test_page99/)
      return Response.json({ data: approvedOnSecondPage ? [{ ...charge, id: 'chr_test_secondpage', paid: true }] : [] })
    }
    assert.equal(await verifyCulqiNoCharge('sk_test_SYNTHETIC', expected), !approvedOnSecondPage)
    assert.equal(pages, 2)
  })
})
test('malformed or unavailable list evidence never permits clearing', async () => {
  await evidence(async () => {
    const mock = globalThis.fetch
    globalThis.fetch = async (url, init) => String(url).includes('/v2/charges?') ? Response.json({ data: null }) : mock(url, init)
    assert.equal(await verifyCulqiNoCharge('sk_test_SYNTHETIC', expected), false)
  })
})

// Execute the actual Function source with only I/O modules substituted. No business logic copied.
const source = readFileSync(new URL('../netlify/functions/gift-card-reconcile.ts', import.meta.url), 'utf8')
const executable = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/^import .* from .*;?\r?\n/gm, '').replace('export default', 'return')
const dependencies = ['json', 'evaluateReconciledChargeResponse', 'getCulqiEnvironment', 'validateCulqiChargeId', 'validateCulqiOrderId',
  'verifyCulqiNoCharge', 'clearMixedCulqiAttempt', 'completeMixedCulqiAttempt', 'getMixedCulqiAttempts', 'getOrderGiftPayment', 'markMixedCulqiAttempt', 'getOrder', 'saveOrder']

async function handlerCase(mutate = () => {}, role = 'admin') {
  const oldFetch = globalThis.fetch, oldEnv = { ...process.env }
  process.env.SUPABASE_URL = 'https://staging.example.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-only'
  process.env.CULQI_SECRET_KEY = 'sk_test_SYNTHETIC'
  const fixture = {
    attempt: { id: expected.attemptIds[0], order_id: expected.databaseOrderId, checkout_id: expected.checkoutId,
      culqi_order_id: expected.id, gift_amount: 40, culqi_amount: 10, status: 'rejected' },
    payment: { order_id: expected.databaseOrderId, checkout_id: expected.checkoutId, gift_card_id: 'card', gift_amount: 40,
      other_amount: 10, status: 'reserved', payment_state: 'failed', reserved_at: expected.since },
    row: { order_number: expected.orderNumber, checkout_id: expected.checkoutId, gift_card_id: 'card', gift_card_amount: 40,
      other_payment_amount: 10, total: 50, culqi_order_id: expected.id, culqi_charge_id: null, payment_status: 'pending' },
    stored: { checkoutId: expected.checkoutId, paymentStatus: 'pending', culqiOrderId: expected.id, total: 50 },
    history: [], externalOrder: { ...order }, charges: [charge], clearCalls: 0, saveCalls: 0, providerCalls: 0,
  }
  mutate(fixture)
  globalThis.fetch = async (url) => {
    const path = String(url)
    if (path.includes('/auth/v1/user')) return Response.json({ id: 'synthetic-actor' })
    if (path.includes('/staff_profiles?')) return Response.json(role === 'none' ? [] : [{ role, active: role !== 'inactive' }])
    if (path.includes('/orders?')) return Response.json([fixture.row])
    if (path.includes('/gift_card_transactions?')) return Response.json(fixture.history)
    fixture.providerCalls++
    if (path.includes('/v2/orders/')) return Response.json(fixture.externalOrder)
    if (path.includes('/v2/charges?')) return Response.json({ data: fixture.charges })
    assert.fail(`unexpected request ${path}`)
  }
  const handlers = {
    json: (status, body) => Response.json(body, { status }), evaluateReconciledChargeResponse: () => assert.fail('paid path'),
    getCulqiEnvironment, validateCulqiChargeId: () => false, validateCulqiOrderId, verifyCulqiNoCharge,
    clearMixedCulqiAttempt: async () => { fixture.clearCalls++; return true }, completeMixedCulqiAttempt: () => assert.fail('paid path'),
    getMixedCulqiAttempts: async () => [fixture.attempt], getOrderGiftPayment: async () => fixture.payment,
    markMixedCulqiAttempt: () => assert.fail('no mark permitted'), getOrder: async () => fixture.stored,
    saveOrder: async () => { fixture.saveCalls++ },
  }
  try {
    const handler = new Function(...dependencies, executable)(...dependencies.map(key => handlers[key]))
    const response = await handler(new Request('https://staging.example.invalid/reconcile', { method: 'POST',
      headers: { authorization: 'Bearer SYNTHETIC' }, body: JSON.stringify({ orderId: expected.databaseOrderId,
        attemptId: expected.attemptIds[0], decision: 'no_charge', confirmNoCharge: true, note: 'Synthetic: deleted order, verified rejected charge, no payment.' }) }))
    return { status: response.status, body: await response.json(), fixture }
  } finally {
    globalThis.fetch = oldFetch
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CULQI_SECRET_KEY']) {
      if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key]
    }
  }
}
for (const role of ['admin', 'manager']) test(`actual handler ${role}: deleted + rejected clears once`, async () => {
  const result = await handlerCase(() => {}, role)
  assert.equal(result.status, 200); assert.equal(result.fixture.clearCalls, 1); assert.equal(result.fixture.saveCalls, 1)
})
for (const role of ['staff', 'kitchen', 'none', 'inactive']) test(`actual handler ${role} denied without writes`, async () => {
  const result = await handlerCase(() => {}, role)
  assert.equal(result.status, 403); assert.equal(result.fixture.clearCalls, 0)
})
for (const [label, mutate] of [
  ['redemption', f => { f.history = [{ id: 'existing-redemption' }] }],
  ['other checkout', f => { f.attempt.checkout_id = 'other' }],
  ['applied reservation', f => { f.payment.status = 'applied' }],
  ['released reservation', f => { f.payment.status = 'released' }],
  ['approved attempt', f => { f.attempt.status = 'approved' }],
  ['paid DB order', f => { f.row.payment_status = 'paid' }],
  ['linked charge', f => { f.row.culqi_charge_id = 'chr_test_approved' }],
  ['attempt linked charge', f => { f.attempt.culqi_charge_id = 'chr_test_uncertain' }],
  ['wrong split', f => { f.row.total = 49 }],
  ['pending Culqi order', f => { f.externalOrder.state = 'pending' }],
  ['approved charge', f => { f.charges = [{ ...charge, paid: true, outcome: { type: 'venta_exitosa' } }] }],
]) test(`actual handler rejects ${label} without financial writes`, async () => {
  const result = await handlerCase(mutate)
  assert.ok(result.status >= 400); assert.equal(result.fixture.clearCalls, 0); assert.equal(result.fixture.saveCalls, 0)
})
test('actual handler repeated cleared/released resolution returns idempotently without RPC/audit writes', async () => {
  const result = await handlerCase(f => { f.attempt.status = 'cleared_no_charge'; f.payment.status = 'released';
    f.payment.payment_state = 'released'; f.row.payment_status = 'expired'; f.stored.paymentStatus = 'expired' })
  assert.equal(result.status, 200); assert.equal(result.body.idempotent, true)
  assert.equal(result.fixture.clearCalls, 0); assert.equal(result.fixture.saveCalls, 0); assert.equal(result.fixture.providerCalls, 0)
})
