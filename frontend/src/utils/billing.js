export function formatUsdDeduction(value) {
  if (value === null || value === undefined || value === '') return '—'
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? `$${amount.toFixed(6)}` : '—'
}
