import test from 'node:test'
import assert from 'node:assert/strict'
import { fromJPY, getCurrencySymbol, toJPY } from '../src/lib/currency.js'

const settings = {
  exchange_rates: [
    { to: 'JPY', rate: 1, symbol: '¥' },
    { to: 'USD', rate: 0.01, symbol: '$' },
  ]
}

test('converts an edited price between its entry currency and stored JPY', () => {
  assert.equal(fromJPY(1250, 'USD', settings), 12.5)
  assert.equal(toJPY(12.5, 'USD', settings), 1250)
})

test('uses the configured symbol for the entry currency', () => {
  assert.equal(getCurrencySymbol('USD', settings), '$')
})
