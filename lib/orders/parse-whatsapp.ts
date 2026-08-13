// Parses the WhatsApp order blob into draft orders.
//
// Pure and dependency-free so it can be unit-tested against real order lists.
// The same engine is intended to back an inbound WhatsApp webhook later, so it
// never assumes the whole day arrives in one message: parseOrderBlock() handles
// a single customer's message on its own.
//
// Real input looks like:
//
//   11 Aug  dinner
//
//   Shoaib27
//   Rumali 2
//   khema
//
//   sylvista
//   white rice+ korma
//
// Blank lines separate customers. The first line of a block is the customer,
// the rest are items. Everything is misspelled, inconsistently spaced, and
// sometimes carries a size ("500ml") or an explicit price ("12aed").

export type MealPeriod = 'breakfast' | 'lunch' | 'dinner'

export type MenuItemRef = {
  id: string
  name: string
  meal_period: string
  price: number
}

export type CustomerRef = {
  id: string
  full_name: string
  customer_code: string
  mobile_number: string | null
}

export type MatchQuality = 'exact' | 'fuzzy' | 'ambiguous' | 'none'

export type ParsedItem = {
  raw: string
  menu_item_id: string | null
  name: string
  quantity: number
  unit_price: number
  note: string | null
  match: MatchQuality
}

export type ParsedOrder = {
  /** Position in the pasted text, used as a stable React key. */
  index: number
  rawBlock: string
  rawCustomer: string
  customer_id: string | null
  customerLabel: string | null
  customerMatch: MatchQuality
  /** Populated when the customer name matched more than one record. */
  candidates: CustomerRef[]
  items: ParsedItem[]
  total: number
  issues: string[]
}

export type ParseResult = {
  orderDate: string | null
  mealPeriod: MealPeriod | null
  headerLine: string | null
  orders: ParsedOrder[]
  /** Customers appearing in more than one block — usually a duplicated message. */
  duplicateCustomers: string[]
}

// ── Text normalisation ───────────────────────────────────────────────────────

/** Lowercase, strip accents and punctuation, collapse whitespace. */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalised with all spaces removed — "ADNAN 2075" and "Adnan2075" collapse to the same key. */
function squash(s: string): string {
  return norm(s).replace(/\s/g, '')
}

/** Letters only — "ARSHAD 2217" and "Arshad" collapse to the same key. */
function letters(s: string): string {
  return norm(s).replace(/[^a-z]/g, '')
}

// Common misspellings seen in real orders, corrected token by token before
// matching against the menu. Keys and values are already normalised.
const TOKEN_FIXES: Record<string, string> = {
  mot: 'moti', mori: 'moti', motti: 'moti',
  chpati: 'chapati', chapathi: 'chapati', chappati: 'chapati', roti1: 'roti',
  rumaali: 'rumali', rumal: 'rumali', roomali: 'rumali',
  khema: 'kheema', keema: 'kheema', qeema: 'kheema',
  shmla: 'shimla', shimlaa: 'shimla', simla: 'shimla',
  alo: 'aloo', aalo: 'aloo', allo: 'aloo',
  chkn: 'chicken', chiken: 'chicken', chikn: 'chicken',
  kadhi: 'kadhai', kadai: 'kadhai', kadi: 'kadhai',
  // NB: no mutter→matar mapping. The menu spells it "ALOO MUTTER", so
  // normalising to "matar" moved the text away from the row it should match.
  muter: 'mutter', mattar: 'mutter',
  biriyani: 'biryani', briyani: 'biryani', biriani: 'biryani',
  pulav: 'pulao', pilao: 'pulao', pulaw: 'pulao',
  tarka: 'tadka', tadaka: 'tadka',
  qorma: 'korma', kurma: 'korma',
}

/**
 * Whole-line names that refer to the same dish. House conventions rather than
 * spellings, so they cannot live in TOKEN_FIXES — "roti" on its own means
 * rumali, but the same word inside "moti roti" must be left alone.
 *
 * Deliberately two-way rather than a rewrite: the menu might call it "Steam
 * Rice" while customers write "white rice", or the reverse. Every name in a
 * group is tried against the menu and the best match wins, so either naming
 * works and adding a synonym can never break an existing match.
 */
const PHRASE_SYNONYMS: string[][] = [
  ['roti', 'rumali roti', 'rumali'],
  ['moti', 'moti roti'],
  ['chapati', 'wheat chapati'],
  ['kheema', 'tawa kheema'],
  ['korma', 'chicken korma'],
  ['white rice', 'steam rice', 'steamed rice', 'plain rice', 'rice'],
  // Combo rows the kitchen sells as one dish
  ['white rice korma', 'white rice chicken korma'],
  // House name for the gajar version. Plain "aloo mutter" is a DIFFERENT dish
  // and is deliberately absent here, so it never silently becomes the gajar one.
  ['mix veg', 'mixveg', 'aloo mutter gajar'],
]

const SIZE_UNITS = new Set(['ml', 'ltr', 'l', 'g', 'gm', 'kg'])

/**
 * Spelling normalisation — safe to apply to menu names as well as order text.
 * Also joins a size onto its unit so the menu's "DAL TADKA - 500 ML" and a
 * customer's "dal tadka 500ml" reduce to the same string.
 */
function applyTokenFixes(s: string): string {
  const tokens = norm(s).split(' ').filter(Boolean)
  const out: string[] = []
  for (const t of tokens) {
    const prev = out[out.length - 1]
    if (SIZE_UNITS.has(t) && prev && /^\d+$/.test(prev)) out[out.length - 1] = prev + t
    else out.push(TOKEN_FIXES[t] ?? t)
  }
  return out.join(' ')
}

/** Every name the customer's text could be referring to, including itself. */
function expandQuery(q: string): string[] {
  for (const group of PHRASE_SYNONYMS) {
    if (group.includes(q)) return group
  }
  return [q]
}

// Trailing annotations staff add to customer names that are not part of the name.
const CUSTOMER_NOISE = new Set(['new', 'start', 'strt', 'str', 'starts', 'started', 'p', 'gt'])

function cleanCustomerName(raw: string): string {
  // "Nabeel +" / "jarnail sing ++ gt 3 p" — everything from the first + is an annotation
  const beforePlus = raw.split('+')[0]
  const tokens = norm(beforePlus).split(' ').filter(Boolean)
  while (tokens.length > 1 && CUSTOMER_NOISE.has(tokens[tokens.length - 1])) tokens.pop()
  return tokens.join(' ')
}

// ── Similarity ───────────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[b.length]
}

/** 0..1 similarity. Substring containment scores high so "makat" ~ "makata". */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length)
  const contains = a.includes(b) || b.includes(a)
    ? Math.min(a.length, b.length) / Math.max(a.length, b.length)
    : 0
  return Math.max(lev, contains)
}

/**
 * Whole-word containment: "rumali" against "rumali roti" scores near 1.
 *
 * Plain edit distance under-scores a short order line against a longer menu
 * name — "Rumali" vs "Rumali Roti" lands at 0.60, below any sane threshold —
 * even though every word the customer wrote is present in the menu item.
 */
function tokenScore(query: string, target: string): number {
  const q = query.split(' ').filter(Boolean)
  const t = target.split(' ').filter(Boolean)
  if (!q.length || !t.length) return 0
  const pool = new Set(t)
  const matched = q.filter(tok => pool.has(tok)).length
  if (matched === q.length) {
    // Every word matched; nudge down slightly when the menu name has extras,
    // so an exact full match still outranks a prefix match.
    return 0.9 + 0.1 * (q.length / Math.max(q.length, t.length))
  }
  return (matched / q.length) * 0.7
}

// ── Customer matching ────────────────────────────────────────────────────────

const CUSTOMER_ACCEPT = 0.72
const CUSTOMER_AMBIGUOUS_GAP = 0.06

function matchCustomer(
  rawLine: string,
  customers: CustomerRef[],
): { id: string | null; label: string | null; match: MatchQuality; candidates: CustomerRef[] } {
  const cleaned = cleanCustomerName(rawLine)
  const key = cleaned.replace(/\s/g, '')
  if (!key) return { id: null, label: null, match: 'none', candidates: [] }

  // 1. Exact on squashed full name / code — "Adnan2075" vs "ADNAN 2075"
  let exact = customers.filter(
    c => squash(c.full_name) === key || squash(c.customer_code) === key,
  )

  // Names are stored with a trailing number ("ARSHAD 2217") that staff often
  // omit. When the written name carries no digits of its own, compare on
  // letters alone — but only then, so "NAEEM 1363" and "NAEEM 3111" stay
  // distinguishable whenever the number is actually given.
  if (exact.length === 0 && !/\d/.test(key)) {
    exact = customers.filter(c => letters(c.full_name) === key)
  }

  if (exact.length === 1) {
    return { id: exact[0].id, label: exact[0].full_name, match: 'exact', candidates: [] }
  }
  if (exact.length > 1) {
    return { id: null, label: null, match: 'ambiguous', candidates: exact }
  }

  // 2. Phone digits appearing in the line
  const digits = rawLine.replace(/\D/g, '')
  if (digits.length >= 7) {
    const byPhone = customers.filter(c => (c.mobile_number ?? '').replace(/\D/g, '').endsWith(digits))
    if (byPhone.length === 1) {
      return { id: byPhone[0].id, label: byPhone[0].full_name, match: 'exact', candidates: [] }
    }
  }

  // 3. Fuzzy
  //
  // The trailing number in a name is an ID, not a spelling. "Micheal3284" and
  // "MICHEL 3264" differ by one digit and score high on any string measure, but
  // they are two different people — so when both sides carry a number and the
  // numbers disagree, the candidate is dropped no matter how close the letters
  // are. Better to ask than to bill the wrong customer.
  const queryDigits = key.replace(/\D/g, '')

  const scored = customers
    .map(c => ({
      c,
      score: Math.max(
        similarity(key, squash(c.full_name)),
        similarity(cleaned, norm(c.full_name)),
        similarity(key, letters(c.full_name)),
        tokenScore(cleaned, norm(c.full_name)),
      ),
    }))
    .filter(s => {
      if (s.score < CUSTOMER_ACCEPT) return false
      const candDigits = squash(s.c.full_name).replace(/\D/g, '')
      if (queryDigits && candDigits && queryDigits !== candDigits) return false
      return true
    })
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) return { id: null, label: null, match: 'none', candidates: [] }

  // Two near-equal candidates is a real ambiguity — make a human choose.
  if (scored.length > 1 && scored[0].score - scored[1].score < CUSTOMER_AMBIGUOUS_GAP) {
    return { id: null, label: null, match: 'ambiguous', candidates: scored.slice(0, 5).map(s => s.c) }
  }
  return { id: scored[0].c.id, label: scored[0].c.full_name, match: 'fuzzy', candidates: [] }
}

// ── Item matching ────────────────────────────────────────────────────────────

const ITEM_ACCEPT = 0.62
const ITEM_AMBIGUOUS_GAP = 0.02

function matchMenuItem(text: string, menu: MenuItemRef[]): { item: MenuItemRef | null; match: MatchQuality } {
  const q = applyTokenFixes(text)
  if (!q) return { item: null, match: 'none' }

  const variants = expandQuery(q)

  const exact = menu.filter(m => variants.includes(applyTokenFixes(m.name)))
  if (exact.length === 1) return { item: exact[0], match: 'exact' }
  if (exact.length > 1) return { item: null, match: 'ambiguous' }

  const scored = menu
    .map(m => {
      const target = applyTokenFixes(m.name)
      return {
        m,
        score: Math.max(
          ...variants.map(v => Math.max(
            similarity(v.replace(/\s/g, ''), target.replace(/\s/g, '')),
            tokenScore(v, target),
          )),
        ),
      }
    })
    .filter(s => s.score >= ITEM_ACCEPT)
    .sort((a, b) => b.score - a.score)

  if (!scored.length) return { item: null, match: 'none' }

  // A bare "roti" fits both Rumali Roti and Moti Roti — never guess between
  // two equally good matches on something that ends up on an invoice.
  if (scored.length > 1 && scored[0].score - scored[1].score < ITEM_AMBIGUOUS_GAP) {
    return { item: null, match: 'ambiguous' }
  }

  // Anything that is not an outright name match is a suggestion, never a
  // decision. Scoring a partial match as certain is what turned "aloo mutter"
  // into ALOO MUTTER GAJAR — a different dish that happened to contain every
  // word. House shorthands earn certainty by being listed in PHRASE_SYNONYMS,
  // not by scoring well.
  return { item: scored[0].m, match: 'fuzzy' }
}

// ── Item line parsing ────────────────────────────────────────────────────────

type Extracted = {
  text: string
  /** Same text with the size appended, so "DAL TADKA - 500 ML" can match. */
  textWithSize: string
  quantity: number | null
  note: string | null
  price: number | null
}

/**
 * Portion sizes that appear as a bare number, e.g. "spl chicken kadhai 250".
 * Read as a size rather than a quantity — nobody orders 250 portions, and
 * treating it as one produced a 250 × AED 7 line.
 */
const BARE_SIZES = new Set([250, 350, 500, 750, 1000])

/** Above this a quantity is more likely a misread size than a real count. */
const IMPLAUSIBLE_QUANTITY = 20

/** House words for the two portions the kitchen sells. */
const SIZE_WORDS: Record<string, string> = {
  small: '250ml', sml: '250ml', smal: '250ml', chota: '250ml',
  large: '500ml', larg: '500ml', lrg: '500ml', big: '500ml', bada: '500ml',
}

/** Pull size, explicit price and quantity out of one item segment. */
function extract(segment: string): Extracted {
  let s = segment.trim()
  let note: string | null = null
  let price: number | null = null
  let quantity: number | null = null

  // "small" / "large" — the words customers actually use for 250ml and 500ml
  for (const [word, ml] of Object.entries(SIZE_WORDS)) {
    const re = new RegExp(`\\b${word}\\b`, 'i')
    if (re.test(s)) { note = ml; s = s.replace(re, ' '); break }
  }

  // "500ml" / "1 ltr" — a size, never a quantity
  if (!note) {
    const size = s.match(/(\d+)\s*(ml|ltr|l|g|kg|gm)\b/i)
    if (size) {
      note = size[1] + size[2].toLowerCase()
      s = s.replace(size[0], ' ')
    }
  }

  // "12aed" / "aed 12" / "12 dhs"
  const priceMatch = s.match(/(?:aed|dhs?|rs)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:aed|dhs?|rs)/i)
  if (priceMatch) {
    price = parseFloat(priceMatch[1] ?? priceMatch[2])
    s = s.replace(priceMatch[0], ' ')
  }

  // A bare portion size written without its unit — "spl chicken kadhai 250"
  if (!note) {
    const bare = s.match(/\b(\d{3,4})\b/)
    if (bare && BARE_SIZES.has(parseInt(bare[1], 10))) {
      note = bare[1] + 'ml'
      s = s.replace(bare[0], ' ')
    }
  }

  // Whatever standalone number is left is the quantity
  const qty = s.match(/\b(\d+)\b/)
  if (qty) {
    quantity = parseInt(qty[1], 10)
    s = s.replace(qty[0], ' ')
  }

  const text = s.replace(/\s+/g, ' ').trim()

  return {
    text,
    // Rebuilt from the normalised note rather than the original wording, so
    // "500", "500 ML" and "large" all end up matching "… - 500ML".
    textWithSize: note ? `${text} ${note}`.trim() : text,
    quantity,
    note,
    price,
  }
}

/**
 * Split an item line into segments.
 *
 * "+" is overloaded: "white rice+ korma" separates two items, but "Rumali +1"
 * means quantity 1. A segment that is only digits is treated as the previous
 * segment's quantity rather than a new item.
 */
function splitSegments(line: string): { text: string; quantity: number | null }[] {
  const parts = line.split('+').map(p => p.trim()).filter(Boolean)
  const out: { text: string; quantity: number | null }[] = []
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      if (out.length) out[out.length - 1].quantity = parseInt(part, 10)
      continue
    }
    out.push({ text: part, quantity: null })
  }
  return out
}

function parseItemLine(line: string, menu: MenuItemRef[]): ParsedItem[] {
  // The menu carries combo rows ("WHITE RICE + CHICKEN KORMA") and size rows
  // ("DAL TADKA - 500 ML" at double the price), so the whole line is tried as a
  // single item before "+" is treated as a separator and before the size is
  // discarded. Only a confident match wins; anything less falls through.
  const whole = extract(line)
  for (const candidate of [whole.textWithSize, whole.text]) {
    if (!candidate) continue
    const { item, match } = matchMenuItem(candidate, menu)
    if (item && match === 'exact') {
      const usedSize = candidate === whole.textWithSize && whole.note !== null
      return [{
        raw: line.trim(),
        menu_item_id: item.id,
        name: item.name,
        quantity: whole.quantity && whole.quantity > 0 ? whole.quantity : 1,
        unit_price: whole.price ?? item.price,
        // Size already baked into the matched SKU — don't repeat it as a note.
        note: usedSize ? null : whole.note,
        match: 'exact',
      }]
    }
  }

  const items: ParsedItem[] = []
  for (const seg of splitSegments(line)) {
    const ex = extract(seg.text)
    if (!ex.text) continue
    const { item, match } = matchMenuItem(ex.text, menu)
    // An explicit "+N" wins over a number embedded in the same segment.
    const quantity = seg.quantity ?? ex.quantity ?? 1
    items.push({
      raw: seg.text.trim(),
      menu_item_id: item?.id ?? null,
      name: item?.name ?? ex.text,
      quantity: quantity > 0 ? quantity : 1,
      unit_price: ex.price ?? item?.price ?? 0,
      note: ex.note,
      match: item ? match : match === 'ambiguous' ? 'ambiguous' : 'none',
    })
  }
  return items
}

// ── Header ───────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function parseHeader(line: string, fallbackYear: number): { date: string | null; meal: MealPeriod | null } {
  const n = norm(line)
  const meal: MealPeriod | null =
    n.includes('breakfast') ? 'breakfast'
    : n.includes('lunch')   ? 'lunch'
    : n.includes('dinner')  ? 'dinner'
    : null

  let date: string | null = null
  // "11 Aug" / "11 Aug 2026" / "Aug 11"
  const dm = n.match(/\b(\d{1,2})\s+([a-z]{3,4})\b(?:\s+(\d{4}))?/) ?? n.match(/\b([a-z]{3,4})\s+(\d{1,2})\b(?:\s+(\d{4}))?/)
  if (dm) {
    const a = dm[1], b = dm[2]
    const day = /^\d+$/.test(a) ? parseInt(a, 10) : parseInt(b, 10)
    const monToken = /^\d+$/.test(a) ? b : a
    const month = MONTHS[monToken.slice(0, 4)] ?? MONTHS[monToken.slice(0, 3)]
    const year = dm[3] ? parseInt(dm[3], 10) : fallbackYear
    if (month && day >= 1 && day <= 31) {
      date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  } else {
    // "2026-08-11"
    const iso = n.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/)
    if (iso) date = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  }

  return { date, meal }
}

/** A line is a header if it carries a meal period or a date but no menu match. */
function looksLikeHeader(line: string): boolean {
  const n = norm(line)
  if (/\b(breakfast|lunch|dinner)\b/.test(n)) return true
  return /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/.test(n)
}

// ── Public API ───────────────────────────────────────────────────────────────

export type ParseOptions = {
  menu: MenuItemRef[]
  customers: CustomerRef[]
  /** Used when the pasted header omits a year, and as the fallback order date. */
  today: string
  /** Fallback when the header has no meal period. */
  defaultMeal?: MealPeriod
}

export function parseWhatsAppOrders(raw: string, opts: ParseOptions): ParseResult {
  const { menu, customers, today, defaultMeal } = opts
  const fallbackYear = parseInt(today.slice(0, 4), 10)

  const lines = raw.replace(/\r\n/g, '\n').split('\n')

  // Split into blocks on blank lines
  const blocks: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    if (!line.trim()) {
      if (current.length) { blocks.push(current); current = [] }
      continue
    }
    current.push(line.trim())
  }
  if (current.length) blocks.push(current)

  let orderDate: string | null = null
  let mealPeriod: MealPeriod | null = null
  let headerLine: string | null = null

  // A leading header block ("11 Aug  dinner") applies to everything after it
  if (blocks.length && blocks[0].length === 1 && looksLikeHeader(blocks[0][0])) {
    const h = parseHeader(blocks[0][0], fallbackYear)
    orderDate = h.date
    mealPeriod = h.meal
    headerLine = blocks[0][0]
    blocks.shift()
  }

  const orders: ParsedOrder[] = []

  blocks.forEach((block, index) => {
    // A header can also sit at the top of a block rather than alone
    if (looksLikeHeader(block[0]) && block.length > 1) {
      const h = parseHeader(block[0], fallbackYear)
      if (h.date || h.meal) {
        orderDate = h.date ?? orderDate
        mealPeriod = h.meal ?? mealPeriod
        headerLine = headerLine ?? block[0]
        block = block.slice(1)
      }
    }
    if (!block.length) return

    const [customerLine, ...itemLines] = block
    const cm = matchCustomer(customerLine, customers)

    const items = itemLines.flatMap(l => parseItemLine(l, menu))

    const issues: string[] = []
    if (cm.match === 'none')      issues.push('Customer not recognised')
    if (cm.match === 'ambiguous') issues.push('Customer name matches more than one record')
    if (cm.match === 'fuzzy')     issues.push('Customer matched by similarity — confirm')
    if (!items.length)            issues.push('No items found')
    for (const it of items) {
      if (it.match === 'ambiguous') issues.push(`"${it.raw}" matches more than one menu item — pick one`)
      else if (!it.menu_item_id)    issues.push(`Unknown item: "${it.raw}"`)
      else if (it.match === 'fuzzy') issues.push(`Item matched by similarity: "${it.raw}" → ${it.name}`)
      if (it.menu_item_id && it.unit_price <= 0) issues.push(`No price for "${it.name}"`)
      // Backstop for a portion size read as a count. Legitimate bulk orders
      // exist, so this asks rather than blocks.
      if (it.quantity > IMPLAUSIBLE_QUANTITY) {
        issues.push(`Quantity ${it.quantity} on "${it.raw}" looks like a size, not a count — confirm`)
      }
    }

    orders.push({
      index,
      rawBlock: block.join('\n'),
      rawCustomer: customerLine,
      customer_id: cm.id,
      customerLabel: cm.label,
      customerMatch: cm.match,
      candidates: cm.candidates,
      items,
      total: items.reduce((s, i) => s + i.quantity * i.unit_price, 0),
      issues,
    })
  })

  // Flag the same customer appearing twice — usually a duplicated message,
  // but occasionally a genuine second order, so we surface rather than merge.
  const seen = new Map<string, number>()
  for (const o of orders) {
    const key = o.customer_id ?? squash(o.rawCustomer)
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const duplicateCustomers = orders
    .filter(o => (seen.get(o.customer_id ?? squash(o.rawCustomer)) ?? 0) > 1)
    .map(o => o.customerLabel ?? o.rawCustomer)
    .filter((v, i, arr) => arr.indexOf(v) === i)

  for (const o of orders) {
    const key = o.customer_id ?? squash(o.rawCustomer)
    if ((seen.get(key) ?? 0) > 1) o.issues.push('This customer appears more than once in the paste')
  }

  return {
    orderDate: orderDate ?? today,
    mealPeriod: mealPeriod ?? defaultMeal ?? null,
    headerLine,
    orders,
    duplicateCustomers,
  }
}

/** Aggregate packing counts across parsed orders — the kitchen view. */
export function packingTotals(orders: ParsedOrder[]): { name: string; quantity: number }[] {
  const map = new Map<string, number>()
  for (const o of orders) {
    for (const it of o.items) {
      const key = it.name + (it.note ? ` (${it.note})` : '')
      map.set(key, (map.get(key) ?? 0) + it.quantity)
    }
  }
  return [...map.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
}
