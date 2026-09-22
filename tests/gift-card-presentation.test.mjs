import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectiveGiftCardStatus, giftCardSection, groupGiftCards } from '../src/staff/giftCardPresentation.ts'

const now = Date.parse('2026-09-22T12:00:00Z')
const card = (status, expires_at = '2026-10-22T12:00:00Z') => ({ status, expires_at })

test('groups active, blocked, exhausted and expired without hiding records', () => {
  const cards = [card('active'), card('blocked'), card('exhausted'), card('expired'), card('active', '2026-09-21T12:00:00Z'), card('pending')]
  const { groups, counts } = groupGiftCards(cards, now)
  assert.deepEqual(counts, { active: 1, blocked: 1, exhausted: 1, expired: 2, pending: 1 })
  assert.equal(groups.active.length, 1)
  assert.equal(groups.blocked.length, 1)
  assert.equal(groups.finished.length, 3)
  assert.equal(groups.pending.length, 1)
})

test('a card moving active → blocked → active moves between accordion sections', () => {
  const giftCard = card('active')
  assert.equal(giftCardSection(giftCard, now), 'active')
  giftCard.status = 'blocked'
  assert.equal(giftCardSection(giftCard, now), 'blocked')
  giftCard.status = 'active'
  assert.equal(giftCardSection(giftCard, now), 'active')
})

test('expired active cards appear in finished section; blocked expired cards remain blocked', () => {
  assert.equal(effectiveGiftCardStatus(card('active', '2026-09-21T12:00:00Z'), now), 'expired')
  assert.equal(giftCardSection(card('blocked', '2026-09-21T12:00:00Z'), now), 'blocked')
})
