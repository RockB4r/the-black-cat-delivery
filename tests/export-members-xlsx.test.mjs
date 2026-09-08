import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import ExcelJS from 'exceljs'

test('download is a readable XLSX and user input stays text', async (t) => {
  const source = (await readFile(new URL('../netlify/functions/export-members.ts', import.meta.url), 'utf8'))
    .replace("'exceljs'", JSON.stringify(import.meta.resolve('exceljs')))
  const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`)
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
  })
  globalThis.fetch = async (url) => {
    let data = []
    if (url.includes('/auth/')) data = { id: 'user-id' }
    else if (url.includes('/staff_profiles?')) data = [{ role: 'admin', active: true }]
    else if (!new URL(url).searchParams.has('id')) data = [{
      id: '1', full_name: '=1+1', dni: '00123456', phone: '+51999999999', email: 'test@example.test',
      birth_date: '1990-01-02', joined_at: '2026-09-08T02:00:00Z', points_balance: 15,
      status: 'active', marketing_consent: false,
    }]
    return new Response(JSON.stringify(data))
  }
  const result = await handler(new Request('https://example.test/export', { headers: { Authorization: 'Bearer token' } }))
  assert.equal(result.status, 200)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(await result.arrayBuffer()))
  const sheet = workbook.getWorksheet('Socios')
  assert.equal(sheet.rowCount, 2)
  assert.equal(sheet.getCell('A2').value, '=1+1')
  assert.equal(sheet.getCell('A2').type, ExcelJS.ValueType.String)
  assert.equal(sheet.getCell('C2').value, '00123456')
  assert.equal(sheet.getCell('D2').value, '+51999999999')
  assert.equal(sheet.getCell('H2').value, 15)
  assert.equal(sheet.getCell('J2').value, 'No')
  assert.equal(sheet.views[0].ySplit, 1)
})
