import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseReceiptItemJSON,
  normalizeReceiptItem,
  mergeRecognizedReceiptItem
} from '../src/lib/receiptItem.js'

test('parses a JSON object wrapped in a fenced code block with extra text', () => {
  const text = '识别结果如下：\n```json\n{"name_zh":"牛奶","price":198}\n```\n请核对'
  assert.deepEqual(parseReceiptItemJSON(text), { name_zh: '牛奶', price: 198 })
})

test('takes the first item when the model returns an array', () => {
  const text = '[{"name_zh":"牛奶"},{"name_zh":"面包"}]'
  assert.deepEqual(parseReceiptItemJSON(text), { name_zh: '牛奶' })
})

test('returns null for empty or non-JSON responses', () => {
  assert.equal(parseReceiptItemJSON(''), null)
  assert.equal(parseReceiptItemJSON(null), null)
  assert.equal(parseReceiptItemJSON('无法识别这张图片'), null)
})

test('normalizes missing fields with receipt item fallbacks', () => {
  assert.deepEqual(normalizeReceiptItem({ name_original: '牛乳' }), {
    name_zh: '牛乳',
    name_original: '牛乳',
    category: '其他',
    quantity: 1,
    unit: '个',
    price: null,
    original_price: null,
    is_discount: false,
    discount_info: '',
    expiry_date: '',
    memo: ''
  })
})

test('keeps a zero price and rejects invalid price strings', () => {
  assert.equal(normalizeReceiptItem({ name_zh: '水', price: 0 }).price, 0)
  assert.equal(normalizeReceiptItem({ name_zh: '水', price: '' }).price, null)
  assert.equal(normalizeReceiptItem({ name_zh: '水', price: 'abc' }).price, null)
  assert.equal(normalizeReceiptItem(null), null)
})

test('merges recognized fields without clearing user input when AI cannot read them', () => {
  const current = {
    name_zh: '手填名称',
    name_original: '',
    category: '',
    quantity: 2,
    unit: '个',
    price: '500',
    original_price: '600',
    is_discount: true,
    discount_info: '手填折扣',
    stock_type: 'food'
  }
  const incoming = normalizeReceiptItem({
    name_zh: '牛奶',
    category: '乳制品',
    quantity: 1,
    unit: '盒',
    price: null,
    original_price: null,
    is_discount: false
  })
  const merged = mergeRecognizedReceiptItem(current, incoming, {
    foodCats: ['乳制品'],
    dailyCats: ['日用品'],
    units: ['个', '盒']
  })
  assert.equal(merged.name_zh, '牛奶')
  assert.equal(merged.category, '乳制品')
  assert.equal(merged.quantity, 1)
  assert.equal(merged.unit, '盒')
  assert.equal(merged.price, '500')
  assert.equal(merged.original_price, '600')
  assert.equal(merged.is_discount, true)
  assert.equal(merged.discount_info, '手填折扣')
  assert.equal(merged.stock_type, 'food')
  assert.equal(merged._id, undefined)
})

test('auto selects daily stock type and keeps units inside the configured list', () => {
  const current = { name_zh: '', category: '', quantity: 1, unit: '个', stock_type: 'food' }
  const incoming = normalizeReceiptItem({ name_zh: '洗剂', category: '日用品', unit: '瓶', price: 300 })
  const merged = mergeRecognizedReceiptItem(current, incoming, {
    foodCats: ['乳制品'],
    dailyCats: ['日用品'],
    units: ['个', '瓶']
  })
  assert.equal(merged.stock_type, 'daily')
  assert.equal(merged.unit, '瓶')
  assert.equal(merged.price, 300)
})

test('falls back to a valid category when AI returns one outside the configured lists', () => {
  const current = { name_zh: '牛奶', category: '乳制品', quantity: 1, unit: '个' }
  const incoming = normalizeReceiptItem({ name_zh: '牛奶', category: '不存在的分类' })
  const merged = mergeRecognizedReceiptItem(current, incoming, {
    foodCats: ['乳制品'],
    dailyCats: ['日用品'],
    units: ['个']
  })
  assert.equal(merged.category, '乳制品')
})

test('does not set stock type for non-inventory items', () => {
  const current = { name_zh: '', category: '', quantity: 1, unit: '个', stock_type: 'food' }
  const incoming = normalizeReceiptItem({ name_zh: '塑料袋', category: '非食材' })
  const merged = mergeRecognizedReceiptItem(current, incoming, {
    foodCats: ['乳制品'],
    dailyCats: ['日用品'],
    units: ['个']
  })
  assert.equal(merged.category, '非食材')
  assert.equal(merged.stock_type, 'food')
})
