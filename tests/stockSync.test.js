import test from 'node:test'
import assert from 'node:assert/strict'
import { getPurchaseConsumptionState } from '../src/lib/stockSync.js'

test('keeps the item available when nothing has been consumed', () => {
  assert.deepEqual(getPurchaseConsumptionState(3, 0), {
    consumed_quantity: 0,
    is_fully_consumed: false
  })
})

test('keeps partial consumption available', () => {
  assert.deepEqual(getPurchaseConsumptionState(3, 1.5), {
    consumed_quantity: 1.5,
    is_fully_consumed: false
  })
})

test('marks the purchase item as fully consumed when stock runs out', () => {
  assert.deepEqual(getPurchaseConsumptionState(3, 3), {
    consumed_quantity: 3,
    is_fully_consumed: true
  })
})

test('treats over-consumption as fully consumed', () => {
  assert.deepEqual(getPurchaseConsumptionState(1, 2), {
    consumed_quantity: 2,
    is_fully_consumed: true
  })
})

test('never marks an item without quantity as fully consumed', () => {
  assert.deepEqual(getPurchaseConsumptionState(0, 0), {
    consumed_quantity: 0,
    is_fully_consumed: false
  })
})

test('normalizes string and invalid values', () => {
  assert.deepEqual(getPurchaseConsumptionState('2', '2'), {
    consumed_quantity: 2,
    is_fully_consumed: true
  })
  assert.deepEqual(getPurchaseConsumptionState(null, undefined), {
    consumed_quantity: 0,
    is_fully_consumed: false
  })
  assert.deepEqual(getPurchaseConsumptionState('abc', 'xyz'), {
    consumed_quantity: 0,
    is_fully_consumed: false
  })
})
