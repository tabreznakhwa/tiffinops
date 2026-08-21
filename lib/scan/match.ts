// Fuzzy matching of AI-extracted bill text against existing suppliers and
// inventory items. Pure functions — no I/O. Deliberately simple token-overlap
// scoring: bill lines like "BASMATI RICE XXL 5KG" should find the item
// "Basmati Rice" without needing a real search engine.

export type MatchCandidate = { id: string; score: number }

/** Lowercase, strip punctuation/digits, drop trivial words, singularize. */
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w))
    .map(w => (w.endsWith('es') && w.length > 4 ? w.slice(0, -2) : w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w))
}

const STOP_WORDS = new Set([
  'the', 'and', 'of', 'for', 'llc', 'fze', 'trading', 'co', 'company',
  'kg', 'gm', 'ml', 'ltr', 'pcs', 'pkt', 'box', 'no', 'new', 'fresh',
])

/** 0..1 similarity between two names: token overlap over the smaller set. */
export function nameScore(a: string, b: string): number {
  const ta = tokens(a)
  const tb = new Set(tokens(b))
  if (ta.length === 0 || tb.size === 0) return 0
  let hit = 0
  for (const t of ta) {
    if (tb.has(t)) { hit++; continue }
    // prefix credit: "tomato" vs "tomatoes", "onio" (torn print) vs "onion"
    for (const u of tb) {
      if (u.startsWith(t) || t.startsWith(u)) { hit += 0.5; break }
    }
  }
  return hit / Math.min(ta.length, tb.size)
}

const THRESHOLD = 0.5

/** Best match above threshold, or null. */
export function bestMatch<T extends { id: string; name: string }>(
  query: string | null,
  candidates: T[],
): MatchCandidate | null {
  if (!query) return null
  let best: MatchCandidate | null = null
  for (const c of candidates) {
    const score = nameScore(query, c.name)
    if (score >= THRESHOLD && (!best || score > best.score)) {
      best = { id: c.id, score }
    }
  }
  return best
}
