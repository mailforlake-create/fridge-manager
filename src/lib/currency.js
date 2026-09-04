export function getDisplayRate(settings) {
  const displayCurrency = settings?.display_currency || 'JPY'
  const rates = settings?.exchange_rates || []
  const rate = rates.find(r => r.to === displayCurrency)
  return {
    rate: rate?.rate || 1,
    symbol: rate?.symbol || '¥',
    currency: displayCurrency
  }
}

export function getCurrencySymbol(currency, settings) {
  const rate = (settings?.exchange_rates || []).find(r => r.to === currency)
  return rate?.symbol || currency
}

// JPY金额 → 显示货币
export function formatAmount(jpyAmount, settings) {
  if (jpyAmount == null) return ''
  const { rate, symbol } = getDisplayRate(settings)
  const value = Math.round(jpyAmount * rate * 10) / 10
  return `${symbol}${value.toLocaleString()}`
}

// 录入货币金额 → JPY（存DB用）
export function toJPY(amount, fromCurrency, settings) {
  if (!amount) return null
  if (fromCurrency === 'JPY') return Number(amount)
  const rates = settings?.exchange_rates || []
  const rate = rates.find(r => r.to === fromCurrency)
  if (!rate || !rate.rate) return Number(amount)
  return Math.round(Number(amount) / rate.rate)
}

// JPY金额 → 指定录入货币（编辑既有记录时使用）
export function fromJPY(amount, toCurrency, settings) {
  if (amount == null || amount === '') return ''
  if (toCurrency === 'JPY') return Number(amount)
  const rates = settings?.exchange_rates || []
  const rate = rates.find(r => r.to === toCurrency)
  if (!rate || !rate.rate) return Number(amount)
  return Math.round(Number(amount) * rate.rate * 10) / 10
}

// 显示原始金额（录入时的货币）
export function formatOriginal(originalAmount, currency) {
  if (!originalAmount) return ''
  const symbols = { JPY: '¥', CNY: '¥', USD: '$' }
  const symbol = symbols[currency] || ''
  return `${symbol}${originalAmount} ${currency}`
}
