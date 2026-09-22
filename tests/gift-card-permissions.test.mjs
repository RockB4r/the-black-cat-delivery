import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canManageGiftCards } from '../src/staff/giftCardPermissions.ts'

test('manager and admin share gift card management; staff does not', () => {
  assert.equal(canManageGiftCards('manager'), true)
  assert.equal(canManageGiftCards('admin'), true)
  assert.equal(canManageGiftCards('staff'), false)
})
