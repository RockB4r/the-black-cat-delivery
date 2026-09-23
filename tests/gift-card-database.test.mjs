import test from 'node:test'
import assert from 'node:assert/strict'
import { createGiftPurchase, getGiftPurchase } from '../netlify/lib/gift-cards.ts'

const input = {
  checkoutId: '4656e4ad-ef27-4d70-84f2-02b6a2efb847', amount: 50,
  purchaserName: 'Cliente Prueba', purchaserEmail: 'cliente@example.com', purchaserPhone: null,
  recipientName: null, recipientEmail: null, recipientPhone: null, message: null,
  transferable: true, deliveryMethod: 'personal',
}
const purchase = {
  checkout_id: input.checkoutId, amount: input.amount, purchaser_name: input.purchaserName,
  purchaser_email: input.purchaserEmail, purchaser_phone: input.purchaserPhone,
  recipient_name: input.recipientName, recipient_email: input.recipientEmail,
  recipient_phone: input.recipientPhone, gift_message: input.message,
  transferable: input.transferable, delivery_method: input.deliveryMethod,
}

async function withResponses(responses, run) {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.SUPABASE_URL = 'https://staging.example.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-placeholder'
  let calls = 0
  globalThis.fetch = async () => {
    assert.ok(calls < responses.length, 'unexpected extra request')
    return responses[calls++]
  }
  try {
    await run()
    assert.equal(calls, responses.length)
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
  }
}

const purchaseResponse = () => new Response(JSON.stringify([purchase]), {
  status: 200, headers: { 'content-type': 'application/json' },
})

test('201 with an empty return=minimal body succeeds', async () => {
  await withResponses([new Response(null, { status: 201 }), purchaseResponse()], async () => {
    assert.deepEqual(await createGiftPurchase(input), purchase)
  })
})

test('204 with an empty body succeeds', async () => {
  await withResponses([new Response(null, { status: 204 }), purchaseResponse()], async () => {
    assert.deepEqual(await createGiftPurchase(input), purchase)
  })
})

test('200 with JSON parses correctly', async () => {
  await withResponses([purchaseResponse()], async () => {
    assert.deepEqual(await getGiftPurchase(input.checkoutId), purchase)
  })
})

test('HTTP error retains status and truncated response text', async () => {
  await withResponses([new Response('Backend unavailable: retry later', { status: 503 })], async () => {
    await assert.rejects(getGiftPurchase(input.checkoutId), /HTTP 503: Backend unavailable: retry later/)
  })
})
