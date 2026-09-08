import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'

// Exercise the actual handler without network access or personal data.
const source = (await readFile(new URL('../netlify/functions/export-members.ts', import.meta.url), 'utf8'))
  .replace("import ExcelJS from 'exceljs'", 'const ExcelJS = globalThis.__exportExcelMock')
const compiled = stripTypeScriptTypes(source)
const rows = []
globalThis.__exportExcelMock = { Workbook: class {
  addWorksheet() {
    rows.length = 0
    return { getRow: () => ({}), getColumn: () => ({}), addRow: (row) => rows.push(row) }
  }
  xlsx = { writeBuffer: async () => new Uint8Array([80, 75]) }
} }
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const request = (token = 'test-token', method = 'GET') => new Request('https://example.test/export', {
  method, headers: token ? { Authorization: `Bearer ${token}` } : {},
})
const response = (data, status = 200) => new Response(JSON.stringify(data), { status })

test('admin export authorization, paging and failure handling', async (t) => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.SUPABASE_URL = 'https://example.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
  t.after(() => {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
    delete globalThis.__exportExcelMock
  })
  await t.test('missing session and wrong method never query data', async () => {
    globalThis.fetch = async () => { throw new Error('Unexpected data query') }
    assert.equal((await handler(request(''))).status, 401)
    assert.equal((await handler(request('token', 'POST'))).status, 405)
  })
  await t.test('invalid session is rejected', async () => {
    globalThis.fetch = async () => response({}, 401)
    assert.equal((await handler(request())).status, 401)
  })
  for (const profile of [{ role: 'staff', active: true }, { role: 'manager', active: true }, { role: 'admin', active: false }, null]) {
    await t.test(`reject ${JSON.stringify(profile)} before reading members`, async () => {
      globalThis.fetch = async (url) => {
        if (url.includes('/auth/')) return response({ id: 'user-id' })
        assert.ok(url.includes('/staff_profiles?'))
        return response(profile ? [profile] : [])
      }
      assert.equal((await handler(request())).status, 403)
    })
  }
  await t.test('admin reads every capped page and preserves text and consent', async () => {
    let page = 0
    globalThis.fetch = async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test-token')
      if (url.includes('/auth/')) return response({ id: 'user-id' })
      if (url.includes('/staff_profiles?')) return response([{ role: 'admin', active: true }])
      const query = new URL(url).searchParams
      assert.equal(query.get('id'), page ? `gt.${page}` : null)
      if (++page === 3) return response([])
      return response([{ id: String(page), full_name: '=1+1', dni: '00123456', phone: '+51999999999', points_balance: 12, status: 'active', marketing_consent: false }])
    }
    const result = await handler(request())
    assert.equal(result.status, 200)
    assert.equal(page, 3)
    assert.equal(rows.length, 2)
    assert.deepEqual(rows[0].slice(0, 4), ['=1+1', 'DNI', '00123456', '+51999999999'])
    assert.equal(rows[0][9], 'No')
    assert.equal(result.headers.get('cache-control'), 'private, no-store')
    assert.match(result.headers.get('content-type'), /spreadsheetml/)
  })
  await t.test('failed later page never returns a partial export', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('/auth/')) return response({ id: 'user-id' })
      if (url.includes('/staff_profiles?')) return response([{ role: 'admin', active: true }])
      return new URL(url).searchParams.has('id') ? response({}, 503) : response([{ id: '1', full_name: 'Test' }])
    }
    assert.equal((await handler(request())).status, 500)
  })
})
