import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import * as verification from '../netlify/lib/culqi-verification.ts'

// Execute the real handler with injected persistence/HTTP only. No real requests.
test('webhook payload normalization preserves provider verification and reconciliation', async (t) => {
  const priorKey = process.env.CULQI_SECRET_KEY
  const priorFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = priorFetch
    if (priorKey === undefined) delete process.env.CULQI_SECRET_KEY
    else process.env.CULQI_SECRET_KEY = priorKey
    delete globalThis.__webhookPayload
  })
  let env = 'live', providerState = 'paid', providerAmount = 1000
  let fetches = 0, completions = 0, releases = 0, marks = 0, paid = false
  let attemptStatus = 'reconciliation_required', paymentStatus = 'reserved'
  const dependencies = {
    ...verification,
    getGiftPurchaseByCulqiOrder: async () => null,
    getOrderIdByCulqiOrder: async () => 'ORDER',
    getOrder: async () => ({
      orderId: 'ORDER', databaseOrderId: 'db-order', total: 30,
      paymentStatus: paid ? 'paid' : 'pending', culqiOrderId: `ord_${env}_synthetic`,
    }),
    getOrderGiftPayment: async () => ({
      order_id: 'db-order', gift_amount: 20, other_amount: 10, status: paymentStatus,
    }),
    getMixedCulqiAttempts: async () => [{ id: 'attempt', status: attemptStatus }],
    completeMixedCulqiAttempt: async () => { completions++; paymentStatus = 'applied'; attemptStatus = 'approved' },
    applyGiftToOrder: async () => { assert.fail('uncertain attempt must complete through its RPC') },
    saveOrder: async order => { paid = order.paymentStatus === 'paid' },
    notifyOrder: async () => {},
    confirmPromotionUse: async () => {}, releasePromotion: async () => {},
    getLinkedMixedCulqiCharge: async () => null,
    markMixedCulqiAttempt: async () => { marks++; attemptStatus = 'reconciliation_required' },
    setGiftPaymentState: async () => { marks++ },
    markMixedCulqiExpired: async () => { assert.fail('uncertain reservation must remain held') },
    releaseGiftReservation: async () => { releases++; assert.fail('uncertain reservation must not release') },
    finalizeGiftPurchase: async () => { assert.fail('not a purchase fixture') },
  }
  globalThis.__webhookPayload = dependencies
  const source = readFileSync(new URL('../netlify/functions/culqi-webhook.ts', import.meta.url), 'utf8')
    .replace(/import \{ ([^\n]+) \} from '[^']+'/g, (_, names) => `const { ${names} } = globalThis.__webhookPayload`)
  const handler = (await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`)).default
  globalThis.fetch = async (url, options) => {
    fetches++
    assert.equal(String(url), `https://api.culqi.com/v2/orders/ord_${env}_synthetic`)
    assert.equal(options.headers.Authorization, `Bearer sk_${env}_synthetic`)
    return Response.json({
      id: `ord_${env}_synthetic`, order_number: 'ORDER', amount: providerAmount,
      currency_code: 'PEN', state: providerState,
    })
  }
  const reset = (environment = 'live') => {
    env = environment; process.env.CULQI_SECRET_KEY = `sk_${env}_synthetic`
    fetches = completions = releases = marks = 0; paid = false
    attemptStatus = 'reconciliation_required'; paymentStatus = 'reserved'
    providerState = 'paid'; providerAmount = 1000
  }
  const send = data => handler(new Request('https://staging.invalid/.netlify/functions/culqi-webhook', {
    method: 'POST', body: JSON.stringify(data),
  }))
  const envelope = data => ({ id: `evt_${env}_synthetic`, type: 'order.status.changed', data })
  for (const format of ['object', 'string']) await t.test(`valid ${format} verifies Culqi and completes uncertain payment`, async () => {
    reset(); const value = { id: 'ord_live_synthetic', state: 'expired', amount: 1 }
    assert.equal((await send(envelope(format === 'string' ? JSON.stringify(value) : value))).status, 200)
    assert.equal(fetches, 1); assert.equal(completions, 1); assert.equal(releases, 0); assert.equal(paid, true)
  })
  for (const [name, value] of [
    ['invalid JSON', '{'], ['empty', ''], ['null', null], ['array', []],
    ['encoded array', '[]'], ['encoded null', 'null'], ['primitive', '42'],
    ['missing id', {}], ['incorrect id', { id: 'evt_live_synthetic' }],
  ]) await t.test(`${name} returns 400 before HTTP or mutation`, async () => {
    reset(); assert.equal((await send(envelope(value))).status, 400)
    assert.equal(fetches, 0); assert.equal(completions, 0)
  })
  for (const environment of ['live', 'test']) await t.test(`foreign environment rejected in ${environment}`, async () => {
    reset(environment)
    const foreign = environment === 'live' ? 'test' : 'live'
    assert.equal((await send(envelope(JSON.stringify({ id: `ord_${foreign}_synthetic` })))).status, 400)
    assert.equal(fetches, 0)
  })
  await t.test('unexpected event type is rejected', async () => {
    reset(); assert.equal((await send({ ...envelope({ id: 'ord_live_synthetic' }), type: 'charge.creation.succeeded' })).status, 400)
    assert.equal(fetches, 0)
  })
  await t.test('duplicate and out-of-order payload never double apply or release', async () => {
    reset(); const value = envelope({ id: 'ord_live_synthetic', state: 'paid' })
    assert.equal((await send(value)).status, 200)
    assert.equal((await send({ ...value, data: JSON.stringify({ id: 'ord_live_synthetic', state: 'expired' }) })).status, 200)
    assert.equal(completions, 1); assert.equal(releases, 0); assert.equal(fetches, 2)
  })
  await t.test('provider expired preserves processing uncertainty despite payload paid', async () => {
    reset(); providerState = 'expired'; attemptStatus = 'processing'
    assert.equal((await send(envelope(JSON.stringify({ id: 'ord_live_synthetic', state: 'paid' })))).status, 200)
    assert.equal(completions, 0); assert.equal(releases, 0); assert.equal(marks, 1)
  })
  await t.test('provider amount mismatch is rejected, not trusted payload', async () => {
    reset(); providerAmount = 999
    assert.equal((await send(envelope({ id: 'ord_live_synthetic', amount: 1000 }))).status, 400)
    assert.equal(completions, 0)
  })
  await t.test('direct order legacy payload stays supported', async () => {
    reset(); assert.equal((await send({ id: 'ord_live_synthetic' })).status, 200)
    assert.equal(completions, 1)
  })
})
