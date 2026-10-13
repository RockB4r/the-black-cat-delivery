import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { giftCardOperationBlock } from '../netlify/lib/gift-card-operations.ts'
import { parseGiftCardOperations } from '../src/lib/giftCardOperations.ts'

async function settings(response, run) {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.SUPABASE_URL = 'https://staging.example.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-placeholder'
  let calls = 0
  globalThis.fetch = async (url, options) => {
    calls++
    assert.match(String(url), /app_settings\?key=eq.gift_card_operations&select=value$/)
    assert.equal(options.cache, 'no-store')
    assert.ok(options.signal)
    if (response instanceof Error) throw response
    return response
  }
  try { await run(); assert.equal(calls, 1) } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
  }
}
for (const op of ['sales', 'redemption']) {
  test(`${op} enabled admits; settings fetched fresh`, async () => settings(Response.json([{ value: { gift_card_sales_enabled: true, gift_card_redemption_enabled: true } }]), async () => assert.equal(await giftCardOperationBlock(op), null)))
  test(`${op} disabled rejects with clear 503`, async () => settings(Response.json([{ value: { gift_card_sales_enabled: false, gift_card_redemption_enabled: false } }]), async () => { const r = await giftCardOperationBlock(op); assert.equal(r.status, 503); assert.match((await r.json()).code, /SUSPENDED$/) }))
}
for (const [name, response] of [
  ['missing row',Response.json([])], ['invalid flags',Response.json([{value:{gift_card_sales_enabled:'true',gift_card_redemption_enabled:true}}])],
  ['missing flag',Response.json([{value:{gift_card_sales_enabled:true}}])], ['HTTP 503',new Response('unavailable',{status:503})],
  ['empty JSON',new Response('',{status:200})], ['network timeout',new Error('timeout')], ['duplicate row',Response.json([{value:{}},{value:{}}])],
]) test(`${name} fails closed`, async () => settings(response, async () => { const r=await giftCardOperationBlock('redemption'); assert.equal(r.status,503); assert.equal((await r.json()).code,'GIFT_CARD_SETTINGS_UNAVAILABLE') }))
test('parser rejects truthy strings, missing fields and null', () => { for (const v of [null, {}, {gift_card_sales_enabled:1,gift_card_redemption_enabled:true}]) assert.equal(parseGiftCardOperations(v),null) })
test('gates are before mutation/external POST, not on resolution endpoints', () => {
  const read = name => readFileSync(new URL(`../netlify/functions/${name}.ts`,import.meta.url),'utf8')
  const purchase=read('gift-card-purchase')
  assert.ok(purchase.indexOf("giftCardOperationBlock('sales')") < purchase.indexOf('await createGiftPurchase('))
  const order=read('create-culqi-order')
  assert.ok(order.indexOf("giftCardOperationBlock('redemption')") < order.indexOf('await createOrder('))
  for (const name of ['gift-card-charge','create-culqi-charge']) {
    const s=read(name); assert.ok(s.indexOf('const blocked = await giftCardOperationBlock(') < s.indexOf("await fetch('https://api.culqi.com/v2/charges'"))
    assert.ok(s.indexOf("state === 'paid'") < s.indexOf('const blocked = await giftCardOperationBlock('))
  }
  for (const name of ['culqi-webhook','gift-card-reconcile','gift-card-purchase-status','gift-card-public','gift-card-quote']) assert.doesNotMatch(read(name), /giftCardOperationBlock/)
})
