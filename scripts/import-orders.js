/**
 * Import orders from Excel file for 28 Jun 2026 – 11 Jul 2026
 * Run with: node scripts/import-orders.js [--dry-run]
 * Reads credentials from .env.local automatically.
 */
const XLSX = require('xlsx')
const { createClient } = require('@supabase/supabase-js')
const fs   = require('fs')
const path = require('path')

// Load .env.local without requiring dotenv
;(function loadEnvLocal() {
  try {
    const envPath = path.resolve(__dirname, '..', '.env.local')
    const lines   = fs.readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const eq = line.indexOf('=')
      if (eq < 1) continue
      const key = line.slice(0, eq).trim()
      const val = line.slice(eq + 1).trim()
      if (key && !process.env[key]) process.env[key] = val
    }
  } catch { /* .env.local not found — rely on process.env */ }
})()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const CREATED_BY   = process.env.IMPORT_CREATED_BY || '67264f94-629b-4429-8fe4-5e78556a2589'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Check .env.local.')
  process.exit(1)
}
const EXCEL_FILE    = 'public/APNA CHULHA MAI DUBAI ORDERS FROM 12TH JULY TO 13TH JULY.xlsx'

// Excel date serials: 46215 = 2026-07-12, 46216 = 2026-07-13
const DATE_FROM = 46215
const DATE_TO   = 46216

const isDryRun = process.argv.includes('--dry-run')

function excelDateToStr(serial) {
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000))
  return d.toISOString().split('T')[0]
}

function norm(s) {
  return String(s).trim().toUpperCase()
}

function padCounter(n) {
  return String(n).padStart(5, '0')
}

function orderNumForDate(dateStr, counter) {
  // "AC-A-260628-02670"
  const yy = dateStr.slice(2, 4)
  const mm = dateStr.slice(5, 7)
  const dd = dateStr.slice(8, 10)
  return `AC-A-${yy}${mm}${dd}-${padCounter(counter)}`
}

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // ── 1. Load customers ───────────────────────────────────────────────────
  const { data: customers, error: custErr } = await admin.from('customers').select('id, full_name, customer_code')
  if (custErr) throw custErr

  // Build normalized-name → customer map (first win, prefer uppercase entries)
  const customerMap = new Map()
  for (const c of [...customers].sort((a, b) => a.full_name.localeCompare(b.full_name))) {
    const key = norm(c.full_name)
    if (!customerMap.has(key)) customerMap.set(key, c)
  }

  // Manual aliases: Excel name (normed) → TiffinOps name (normed)
  const ALIASES = {
    'MEARG3190': 'MEARG 3190',
    'JARNAL':    'JARNAIL SINGH 3248',
  }
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (!customerMap.has(alias) && customerMap.has(canonical)) {
      customerMap.set(alias, customerMap.get(canonical))
    }
  }

  // ── 2. Load menu items (first occurrence of each normalized name) ────────
  const { data: menuItems, error: miErr } = await admin.from('menu_items').select('id, name')
  if (miErr) throw miErr

  const itemMap = new Map()
  for (const item of menuItems) {
    const key = norm(item.name)
    if (!itemMap.has(key)) itemMap.set(key, item.id)
  }

  // ── 3. Get current max counter (paginated to avoid 1000-row cap) ──────────
  let maxCounter = 0
  {
    const PAGE = 1000; let off = 0
    while (true) {
      const { data } = await admin.from('orders').select('order_number').range(off, off + PAGE - 1)
      if (!data || data.length === 0) break
      for (const o of data) {
        const match = (o.order_number ?? '').match(/(\d+)$/)
        if (match) maxCounter = Math.max(maxCounter, parseInt(match[1]))
      }
      if (data.length < PAGE) break
      off += PAGE
    }
  }
  let counter = maxCounter + 1
  console.log(`Starting order counter at: ${counter}`)

  // ── 4. Get existing orders in range (paginated to bypass 1000-row cap) ──
  const existingSet = new Set()
  {
    const PAGE = 1000; let off = 0
    while (true) {
      const { data } = await admin.from('orders')
        .select('customer_id, order_date, meal_period')
        .gte('order_date', '2026-07-12').lte('order_date', '2026-07-13')
        .range(off, off + PAGE - 1)
      if (!data || data.length === 0) break
      for (const o of data) existingSet.add(`${o.customer_id}|${o.order_date}|${o.meal_period}`)
      if (data.length < PAGE) break
      off += PAGE
    }
  }
  console.log(`Existing orders in range: ${existingSet.size}`)

  // ── 5. Read Excel ────────────────────────────────────────────────────────
  const wb   = XLSX.readFile(EXCEL_FILE)
  const ws   = wb.Sheets['Orders']
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const rows = data.slice(4).filter(r => typeof r[0] === 'number' && r[0] >= DATE_FROM && r[0] <= DATE_TO)
  console.log(`Excel rows in range: ${rows.length}`)

  // ── 6. Group into orders ─────────────────────────────────────────────────
  const groups     = new Map()
  const unmatchedC = new Set()
  const unmatchedI = new Set()
  let   skippedRows = 0

  for (const row of rows) {
    const dateSerial = row[0]
    const custName   = norm(row[2])
    const mealRaw    = norm(row[3]) // BREAKFAST | LUNCH | DINNER | ADD-ON
    const itemName   = norm(row[4])
    const qty        = Number(row[5]) || 0
    const unitPrice  = Number(row[6]) || 0
    const amount     = Number(row[7]) || 0

    if (!custName || !itemName || qty <= 0) { skippedRows++; continue }

    // Skip Add-on — no matching meal_period in DB
    if (mealRaw === 'ADD-ON') { skippedRows++; continue }

    const customer = customerMap.get(custName)
    if (!customer) { unmatchedC.add(custName); skippedRows++; continue }

    const menuItemId = itemMap.get(itemName) || null
    if (!menuItemId) unmatchedI.add(itemName)

    const dateStr  = excelDateToStr(dateSerial)
    const mealLow  = mealRaw.toLowerCase() // breakfast | lunch | dinner
    const groupKey = `${customer.id}|${dateStr}|${mealLow}`

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        customer_id:   customer.id,
        customer_name: custName,
        order_date:    dateStr,
        meal_period:   mealLow,
        items:         [],
      })
    }
    groups.get(groupKey).items.push({ itemName, menuItemId, qty, unitPrice, amount })
  }

  console.log(`\nSkipped rows: ${skippedRows}`)
  console.log(`Unmatched customers (${unmatchedC.size}):`, [...unmatchedC].sort())
  console.log(`Unmatched items (${unmatchedI.size}):`, [...unmatchedI].sort())

  const toInsert = [...groups.values()].filter(
    g => !existingSet.has(`${g.customer_id}|${g.order_date}|${g.meal_period}`)
  )
  const alreadyExists = groups.size - toInsert.length
  console.log(`\nOrder groups total: ${groups.size}`)
  console.log(`Already exist (skip): ${alreadyExists}`)
  console.log(`To import: ${toInsert.length}`)

  if (isDryRun) {
    console.log('\n=== DRY RUN — no changes made ===')
    // Show first 10 groups as sample
    toInsert.slice(0, 10).forEach(g => {
      const total = g.items.reduce((s, i) => s + i.amount, 0)
      console.log(`  ${g.order_date} | ${g.meal_period.padEnd(9)} | ${g.customer_name.padEnd(25)} | AED ${total.toFixed(2)} | ${g.items.length} items`)
    })
    return
  }

  // ── 7. Insert orders + items ──────────────────────────────────────────────
  let inserted = 0; let failed = 0

  for (const group of toInsert) {
    const subtotal     = group.items.reduce((s, i) => s + i.amount, 0)
    const orderNumber  = orderNumForDate(group.order_date, counter++)
    const orderPayload = {
      order_number:     orderNumber,
      customer_id:      group.customer_id,
      order_date:       group.order_date,
      meal_period:      group.meal_period,
      subtotal:         subtotal,
      discount_amount:  0,
      delivery_charge:  0,
      total_amount:     subtotal,
      payment_status:   'unpaid',
      order_status:     'confirmed',
      is_credit:        true,
      created_by:       CREATED_BY,
    }

    const { data: newOrder, error: orderErr } = await admin.from('orders').insert(orderPayload).select('id').single()
    if (orderErr) {
      console.error(`FAILED order ${orderNumber}:`, orderErr.message)
      failed++
      continue
    }

    const itemPayloads = group.items.map(i => ({
      order_id:           newOrder.id,
      menu_item_id:       i.menuItemId,
      item_name_snapshot: i.itemName,
      quantity:           i.qty,
      unit_price:         i.unitPrice,
      total_price:        i.amount,
    }))

    const { error: itemErr } = await admin.from('order_items').insert(itemPayloads)
    if (itemErr) {
      console.error(`FAILED items for order ${orderNumber}:`, itemErr.message)
      failed++
    } else {
      inserted++
      if (inserted % 50 === 0) console.log(`  Inserted ${inserted}/${toInsert.length}...`)
    }
  }

  console.log(`\n✓ Done. Inserted: ${inserted}, Failed: ${failed}`)
}

main().catch(err => { console.error(err); process.exit(1) })
