// Bank account details shown on every customer invoice/bill
export const BANK_DETAILS = {
  accountName: 'Apna Chulha Restaurant LLC',
  iban: 'AE330860000009271445425',
  bankName: 'WIO BANK',
} as const

// All menu prices are VAT-inclusive at 5%.
// To show the VAT component: vatAmount = total * 5/105
export const VAT_RATE_PERCENT = 5

export function extractVAT(totalInclVAT: number): { exclVAT: number; vatAmount: number } {
  const divisor = 100 + VAT_RATE_PERCENT // 105
  const exclVAT = (totalInclVAT * 100) / divisor
  return { exclVAT, vatAmount: totalInclVAT - exclVAT }
}
