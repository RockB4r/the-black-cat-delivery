import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canManageGiftCards, canUnblockGiftCard } from '../src/staff/giftCardPermissions.ts'

test('manager and admin share gift card management; staff does not', () => {
  assert.equal(canManageGiftCards('manager'), true)
  assert.equal(canManageGiftCards('admin'), true)
  assert.equal(canManageGiftCards('staff'), false)
})

test('only manager and admin may unblock a blocked card with balance before expiry', () => {
  const now = Date.parse('2026-09-22T12:00:00Z')
  const blocked = { status: 'blocked', current_balance: 50, expires_at: '2026-10-22T12:00:00Z' }
  assert.equal(canUnblockGiftCard('admin', blocked, now), true)
  assert.equal(canUnblockGiftCard('manager', blocked, now), true)
  assert.equal(canUnblockGiftCard('staff', blocked, now), false)
})

test('expired or exhausted Gift Cards cannot return to active', () => {
  const now = Date.parse('2026-09-22T12:00:00Z')
  assert.equal(canUnblockGiftCard('admin', { status: 'blocked', current_balance: 50, expires_at: '2026-09-21T12:00:00Z' }, now), false)
  assert.equal(canUnblockGiftCard('admin', { status: 'blocked', current_balance: 0, expires_at: '2026-10-22T12:00:00Z' }, now), false)
  assert.equal(canUnblockGiftCard('admin', { status: 'exhausted', current_balance: 0, expires_at: '2026-10-22T12:00:00Z' }, now), false)
})
