import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FOOD_CATEGORIES,
  DAILY_CATEGORIES,
  ALL_CATEGORIES,
  isDailyCategory
} from '../src/lib/categories.js'

test('ALL_CATEGORIES should not contain duplicate values', () => {
  const uniqueCount = new Set(ALL_CATEGORIES).size
  assert.equal(uniqueCount, ALL_CATEGORIES.length)
})

test('ALL_CATEGORIES should contain all food and daily categories', () => {
  for (const category of [...FOOD_CATEGORIES, ...DAILY_CATEGORIES]) {
    assert.equal(ALL_CATEGORIES.includes(category), true)
  }
})

test('isDailyCategory should classify daily and food categories correctly', () => {
  assert.equal(isDailyCategory('清洁用品'), true)
  assert.equal(isDailyCategory('蔬菜'), false)
  assert.equal(isDailyCategory('不存在分类'), false)
})
