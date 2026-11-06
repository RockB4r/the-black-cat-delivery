import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { randomBytes } from 'node:crypto'
import * as verification from '../netlify/lib/culqi-verification.ts'
import * as mixed from '../netlify/lib/mixed-3ds.ts'
import { parseAuthentication3DS, validDeviceFingerprint, authenticateMixedPayment, configureCulqi3DS } from '../src/lib/culqi3ds.ts'

const checkout = '11111111-1111-4111-8111-111111111111', orderId = '22222222-2222-4222-8222-222222222222'
const attemptId = '33333333-3333-4333-8333-333333333333', fingerprint = '44444444-4444-4444-8444-444444444444'
const parameters = { eci: '05', xid: 'syntheticXid', cavv: 'syntheticCavv', protocolVersion: '2.1.0', directoryServerTransactionId: fingerprint }
let moduleNumber = 0
const request = (extra = {}) => new Request('https://staging.invalid/charge', { method: 'POST', body: JSON.stringify({ checkoutId: checkout,
  internalOrderId: orderId, token: 'tkn_test_fixture', deviceFingerprint: fingerprint, amount: 1000, currency: 'PEN', email: 'test@example.invalid', ...extra }) })
const approved = { id: 'chr_test_fixture', amount: 1000, currency_code: 'PEN', description: 'Pedido TEST', paid: true, outcome: { type: 'venta_exitosa' }, metadata: { checkout_id: checkout, attempt_id: attemptId } }

async function fixture(t, replies = [{ action_code: 'REVIEW' }, approved]) {
  const before = globalThis.fetch, secret = process.env.CULQI_SECRET_KEY
  process.env.CULQI_SECRET_KEY = 'sk_test_fixture'
  const state = { begins: 0, posts: [], completions: 0, phase: null, status: 'processing', lock: false, paid: false, audit: [] }
  const order = () => ({ orderId: 'TEST', databaseOrderId: orderId, checkoutId: checkout, culqiOrderId: 'ord_test_fixture',
    paymentStatus: state.paid ? 'paid' : 'pending', total: 50, email: 'test@example.invalid', phone: '000000000', customer: 'Synthetic Customer', address: '', items: [] })
  const deps = { ...verification, ...mixed, randomBytes, parseAuthentication3DS, validDeviceFingerprint,
    json: (status, body) => Response.json(body, { status }), parseOrderInput: body => ({ checkoutId: body.checkoutId, email: body.email }),
    getOnlineOrderingAvailability: async () => ({ isOpen: true }), getUnavailableProducts: async () => [], ProductAvailabilityError: class extends Error {},
    getOrderByCheckoutId: async () => order(), getOrderGiftPayment: async () => ({ order_id: orderId, gift_amount: 40, other_amount: 10, status: state.paid ? 'applied' : 'reserved', expires_at: new Date(Date.now() + 3600000).toISOString() }),
    getStore: () => ({ set: async () => { const modified = !state.lock; state.lock = true; return { modified } }, delete: async () => { state.lock = false } }),
    giftCardOperationBlock: async () => null,
    beginMixedCulqiAttempt: async () => { state.begins++; return { id: attemptId } },
    transitionMixed3DS: async (oid, aid, hash, continuation, transition) => {
      if (oid !== orderId || aid !== attemptId || state.status !== 'processing') return false
      if (transition === 'initialize' && state.phase === null) { state.hash = hash; state.continuation = continuation; state.phase = 'initial_request_sent'; return true }
      if (hash !== state.hash || continuation !== state.continuation) return false
      if (transition === 'await' && state.phase === 'initial_request_sent') { state.phase = 'awaiting_3ds'; return true }
      if (transition === 'continue' && state.phase === 'awaiting_3ds') { state.phase = 'authenticated_request_sent'; return true }
      if (transition === 'cancel' && state.phase === 'awaiting_3ds') { state.phase = 'authentication_failed'; state.status = 'reconciliation_required'; return true }
      return false
    },
    markMixedCulqiAttempt: async (_, status, source) => { if (state.status !== 'approved') state.status = status; state.audit.push(source) },
    completeMixedCulqiAttempt: async () => { if (!state.paid) { state.completions++; state.paid = true; state.status = 'approved' } return { idempotent: state.completions > 1 } },
    saveOrder: async () => {}, notifyOrder: async () => {}, confirmPromotionUse: async () => {}, releasePromotion: async () => {},
    getMixedCulqiAttempts: async () => [], applyGiftToOrder: async () => assert.fail('unexpected extra application'),
  }
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/orders/')) return Response.json({ id: 'ord_test_fixture', order_number: 'TEST', state: 'pending', amount: 1000, currency_code: 'PEN', expiration_date: Math.floor(Date.now() / 1000) + 3600 })
    assert.equal(String(url), 'https://api.culqi.com/v2/charges')
    state.posts.push(JSON.parse(options.body))
    const reply = replies[state.posts.length - 1]
    if (reply instanceof Error) throw reply
    return reply instanceof Response ? reply : Response.json(reply, { status: 201 })
  }
  globalThis.__mixed3DSTest = deps
  const source = stripTypeScriptTypes(readFileSync(new URL('../netlify/functions/create-culqi-charge.ts', import.meta.url), 'utf8'))
    .replace(/import \{ ([^\n]+) \} from '[^']+'/g, (_, names) => `const { ${names} } = globalThis.__mixed3DSTest`)
  const handler = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${++moduleNumber}`)).default
  t.after(() => { globalThis.fetch = before; if (secret === undefined) delete process.env.CULQI_SECRET_KEY; else process.env.CULQI_SECRET_KEY = secret; delete globalThis.__mixed3DSTest })
  return { state, handler, async start() { const r = await handler(request()); assert.equal(r.status, 202); const body = await r.json(); assert.equal(body.authenticationRequired, true); return { action: 'continue', attemptId: body.attemptId, continuationToken: body.continuationToken, parameters } } }
}

test('3DS backend actual handlers, provider mocked; no external HTTP', async t => {
  await t.test('approved without 3DS completes once', async t => { const f = await fixture(t, [approved]); const r = await f.handler(request()); assert.equal(r.status, 200); assert.equal(f.state.completions, 1) })
  await t.test('REVIEW persists awaiting_3ds; successful continuation reuses context', async t => {
    const f = await fixture(t); const continuation = await f.start(); assert.equal(f.state.phase, 'awaiting_3ds'); assert.equal(f.state.completions, 0)
    const r = await f.handler(request({ threeDS: continuation })); assert.equal(r.status, 200)
    assert.equal(f.state.begins, 1); assert.equal(f.state.completions, 1); assert.equal(f.state.posts.length, 2)
    for (const key of ['source_id', 'amount', 'currency_code', 'metadata', 'antifraud_details']) assert.deepEqual(f.state.posts[0][key], f.state.posts[1][key])
    assert.deepEqual(f.state.posts[1].authentication_3DS, parameters)
    assert.equal((await f.handler(request({ threeDS: continuation }))).status, 200); assert.equal(f.state.posts.length, 2)
  })
  await t.test('two concurrent continuation requests send one authenticated POST', async t => {
    const f = await fixture(t); const c = await f.start(); const results = await Promise.all([f.handler(request({ threeDS: c })), f.handler(request({ threeDS: c }))]);
    assert.ok(results.some(r => r.status === 200)); assert.equal(f.state.posts.length, 2); assert.equal(f.state.completions, 1)
  })
  await t.test('second charge rejected retains reservation with no application', async t => {
    const f = await fixture(t, [{ action_code: 'REVIEW' }, { ...approved, paid: false, outcome: { type: 'operacion_denegada' } }]); const c = await f.start()
    assert.equal((await f.handler(request({ threeDS: c }))).status, 402); assert.equal(f.state.status, 'rejected'); assert.equal(f.state.completions, 0)
    assert.equal((await f.handler(request({ threeDS: c }))).status, 409); assert.equal(f.state.posts.length, 2)
  })
  await t.test('timeout after authentication is uncertain and cannot POST again', async t => {
    const f = await fixture(t, [{ action_code: 'REVIEW' }, new Error('synthetic timeout')]); const c = await f.start()
    assert.equal((await f.handler(request({ threeDS: c }))).status, 502); assert.equal(f.state.status, 'reconciliation_required')
    assert.equal((await f.handler(request({ threeDS: c }))).status, 409); assert.equal(f.state.posts.length, 2); assert.equal(f.state.completions, 0)
  })
  await t.test('cancellation records uncertainty, no authenticated POST', async t => {
    const f = await fixture(t); const c = await f.start(); assert.equal((await f.handler(request({ threeDS: { ...c, action: 'cancel' } }))).status, 202)
    assert.equal(f.state.phase, 'authentication_failed'); assert.equal(f.state.posts.length, 1); assert.equal(f.state.completions, 0)
  })
  for (const [name, change] of Object.entries({ checkout: { checkoutId: '55555555-5555-4555-8555-555555555555' }, amount: { amount: 1001 }, fingerprint: { deviceFingerprint: '55555555-5555-4555-8555-555555555555' }, source: { token: 'tkn_test_other' }, currency: { currency: 'USD' } })) {
    await t.test(`${name} mismatch blocks continuation before POST`, async t => { const f = await fixture(t); const c = await f.start(); assert.ok((await f.handler(request({ threeDS: c, ...change }))).status >= 400); assert.equal(f.state.posts.length, 1) })
  }
  await t.test('incomplete authentication and forged continuation fail closed', async t => {
    const f = await fixture(t); const c = await f.start()
    assert.equal((await f.handler(request({ threeDS: { ...c, parameters: { eci: '05' } } }))).status, 400)
    assert.equal((await f.handler(request({ threeDS: { ...c, continuationToken: 'f'.repeat(64) } }))).status, 409)
    assert.equal(f.state.posts.length, 1)
  })
  await t.test('refresh/new first POST cannot bypass lock during awaiting_3ds', async t => { const f = await fixture(t); await f.start(); assert.equal((await f.handler(request())).status, 409); assert.equal(f.state.posts.length, 1) })
  await t.test('second REVIEW stays uncertain, never starts a third request', async t => {
    const f = await fixture(t, [{ action_code: 'REVIEW' }, { action_code: 'REVIEW' }]); const c = await f.start()
    assert.equal((await f.handler(request({ threeDS: c }))).status, 502); assert.equal(f.state.status, 'reconciliation_required')
    assert.equal((await f.handler(request({ threeDS: c }))).status, 409); assert.equal(f.state.posts.length, 2)
  })
  await t.test('first HTTP 201 without positive evidence is held, no authentication guessed', async t => {
    const f = await fixture(t, [{ ...approved, paid: null, outcome: null }]); const r = await f.handler(request())
    assert.equal(r.status, 502); assert.equal(f.state.status, 'reconciliation_required'); assert.equal(f.state.completions, 0)
  })
  await t.test('wrong TEST/LIVE source is blocked before provider', async t => {
    const f = await fixture(t); assert.equal((await f.handler(request({ token: 'tkn_live_fixture' }))).status, 400); assert.equal(f.state.posts.length, 0)
  })
})

test('classifier never approves denied or HTTP-only bodies; REVIEW is explicit', () => {
  const before = process.env.CULQI_SECRET_KEY; process.env.CULQI_SECRET_KEY = 'sk_test_fixture'
  try {
    const expected = { id: approved.id, amountInCents: 1000, description: approved.description, checkoutId: checkout, attemptId }
    for (const http of [200, 201]) {
      assert.equal(mixed.classifyMixedCharge(approved, expected, http), 'approved')
      assert.equal(mixed.classifyMixedCharge({ ...approved, paid: false, outcome: { type: 'operacion_denegada' } }, expected, http), 'rejected')
      assert.equal(mixed.classifyMixedCharge({ ...approved, paid: null, outcome: null }, expected, http), 'ambiguous')
      assert.equal(mixed.classifyMixedCharge({ action_code: 'REVIEW' }, expected, http), 'authentication_required')
      assert.equal(mixed.classifyMixedCharge({ action_code: 'REVIEW', amount: 999 }, expected, http), 'ambiguous')
    }
  } finally { if (before === undefined) delete process.env.CULQI_SECRET_KEY; else process.env.CULQI_SECRET_KEY = before }
})

test('listener origin/active-context guards, duplicate event and cancellation', async () => {
  const target = Object.assign(new EventTarget(), { location: { origin: 'https://staging.invalid' } })
  let initiated = 0
  const sdk = { initAuthentication() { initiated++ } }
  const p = authenticateMixedPayment(sdk, 'tkn_test_fixture', () => true, target, 1000)
  target.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.invalid', data: { parameters3DS: parameters } }))
  target.dispatchEvent(new MessageEvent('message', { origin: target.location.origin, data: { parameters3DS: parameters } }))
  target.dispatchEvent(new MessageEvent('message', { origin: target.location.origin, data: { parameters3DS: parameters } }))
  assert.deepEqual(await p, parameters); assert.equal(initiated, 1)
  const cancelled = authenticateMixedPayment(sdk, 'tkn_test_fixture', () => true, target, 1000)
  target.dispatchEvent(new Event('pagehide')); await assert.rejects(cancelled, /CANCELLED/)
  const modalCancel = authenticateMixedPayment(sdk, 'tkn_test_fixture', () => true, target, 1000)
  sdk.options.closeModalAction(); await assert.rejects(modalCancel, /CANCELLED/)
  const failure = authenticateMixedPayment(sdk, 'tkn_test_fixture', () => true, target, 1000)
  target.dispatchEvent(new MessageEvent('message', { origin: target.location.origin, data: { error: 'Synthetic authentication failed' } }))
  await assert.rejects(failure, /CANCELLED/)
  await assert.rejects(authenticateMixedPayment(sdk, 'tkn_test_fixture', () => false, target, 5), /CANCELLED/)
})

test('parameters reject unknown/incomplete fields; device must be UUID v4', () => {
  assert.ok(parseAuthentication3DS(parameters)); assert.equal(validDeviceFingerprint(fingerprint), true)
  for (const key of Object.keys(parameters)) { const bad = { ...parameters }; delete bad[key]; assert.equal(parseAuthentication3DS(bad), null) }
  assert.equal(parseAuthentication3DS({ ...parameters, injected: true }), null)
  assert.equal(parseAuthentication3DS({ ...parameters, eci: '07' }), null)
  assert.equal(validDeviceFingerprint('arbitrary'), false)
})

test('settings setter-only SDK accepts complete configuration and backend amount before logical Checkout open', () => {
  const assignments = []
  const sdk = { set settings(value) { assignments.push(structuredClone(value)) } }
  const config = { charge: { totalAmount: 1200, currency: 'PEN', returnUrl: 'https://staging.invalid/' }, card: { email: 'review@culqi.com' } }
  let opened = false
  assert.doesNotThrow(() => {
    configureCulqi3DS(sdk, config)
    configureCulqi3DS(sdk, { ...config, charge: { ...config.charge, totalAmount: 1000 } })
    opened = true
  })
  assert.equal(opened, true)
  assert.deepEqual(assignments, [config, { ...config, charge: { ...config.charge, totalAmount: 1000 } }])
  assert.equal(sdk.settings, undefined)
  // A throwing getter makes any accidental settings read fail the regression.
  const guarded = { set settings(value) { assignments.push(value) }, get settings() { throw new Error('SETTINGS_MUST_NOT_BE_READ') } }
  assert.doesNotThrow(() => configureCulqi3DS(guarded, config))
  for (const invalid of [
    { ...config, charge: { ...config.charge, totalAmount: 0 } },
    { ...config, charge: { ...config.charge, totalAmount: 1000.5 } },
    { ...config, charge: { ...config.charge, currency: 'USD' } },
    { ...config, charge: { ...config.charge, returnUrl: 'javascript:invalid' } },
    { ...config, card: { email: '' } },
  ]) assert.throws(() => configureCulqi3DS(sdk, invalid), /CONFIGURATION_INVALID/)
  assert.equal(assignments.length, 3)
})

test('SPA preserves refresh guard without tokens and does not change independent GiftCardPurchase', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /sessionStorage\.setItem\('tbc-mixed-payment-inflight', JSON\.stringify\(\{ checkoutId: capturedCheckout, orderId: capturedOrder \}\)\)/)
  assert.match(app, /checkoutIdRef\.current !== orderPayload\.checkoutId/)
  assert.match(app, /threeDS\?\.reset\(\)/)
  const open = app.slice(app.indexOf('const openCulqiCheckout ='))
  assert.ok(open.indexOf('await sdk.generateDevice()') < open.indexOf("fetch('/.netlify/functions/create-culqi-order'"))
  const tokenHandler = app.slice(app.indexOf('const handleCulqiAction ='), app.indexOf('const openCulqiCheckout ='))
  assert.doesNotMatch(tokenHandler, /generateDevice\(/)
  assert.match(tokenHandler, /prepared.checkoutId !== capturedCheckout/)
  assert.doesNotMatch(app, /\.settings\b/)
  assert.match(open, /configureCulqi3DS\(mixedDeviceRef.current.sdk,\s*\{\s*charge: \{ totalAmount: amountInCents/)
  assert.doesNotMatch(readFileSync(new URL('../src/GiftCardPurchase.tsx', import.meta.url), 'utf8'), /Culqi3DS|authenticateMixedPayment/)
})
