// scripts/fix-stock-consumption-sync.mjs
// 修复库存表（ingredients / daily_items）与购物履历（purchase_items）的消耗状态不一致。
//
// 用法：
//   node scripts/fix-stock-consumption-sync.mjs             # 预演，只打印差异
//   node scripts/fix-stock-consumption-sync.mjs --apply     # 实际写入 purchase_items
//   node scripts/fix-stock-consumption-sync.mjs --verbose   # 打印全部差异明细
//   node scripts/fix-stock-consumption-sync.mjs --table=ingredients   # 只处理食材
//
// 修复原则：以库存表为准，回写 purchase_items.consumed_quantity 与 is_fully_consumed。
// 不会修改任何库存记录，也不会修改 purchase_items.quantity。

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（请检查 .env.local）')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const verbose = args.includes('--verbose')
const tableArg = args.find(arg => arg.startsWith('--table='))
const onlyTable = tableArg ? tableArg.slice('--table='.length) : null
if (onlyTable && !['ingredients', 'daily_items'].includes(onlyTable)) {
  console.error('--table 只支持 ingredients 或 daily_items')
  process.exit(1)
}

const PAGE_SIZE = 1000

async function fetchAll(table, columns) {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${table} 读取失败：${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function getPurchaseConsumptionState(quantity, consumedQuantity) {
  const qty = toNumber(quantity)
  const consumed = toNumber(consumedQuantity)
  return {
    consumed_quantity: consumed,
    is_fully_consumed: qty > 0 && consumed >= qty
  }
}

function formatChange(change) {
  return [
    `[${change.table === 'daily_items' ? '非食用品' : '食材'}] ${change.name || '(未命名)'}`,
    `库存 ${change.stockConsumed}/${change.stockQuantity}`,
    `小票 ${change.currentConsumed}/${change.currentFull ? '已用完' : '未用完'}`,
    `→ ${change.nextConsumed}/${change.nextFull ? '已用完' : '未用完'}`,
    `(purchase_item_id=${change.purchaseItemId})`
  ].join(' ')
}

console.log(apply ? '=== 修复模式（会写入数据库）===' : '=== 预演模式（不会写入，加 --apply 才执行）===')

const [ingredients, dailyItems, purchaseItems] = await Promise.all([
  fetchAll('ingredients', 'id, name_zh, quantity, consumed_quantity, purchase_item_id'),
  fetchAll('daily_items', 'id, name_zh, quantity, consumed_quantity, purchase_item_id'),
  fetchAll('purchase_items', 'id, name_zh, quantity, consumed_quantity, is_fully_consumed')
])

const purchases = new Map(purchaseItems.map(row => [String(row.id), row]))
const stockRows = [
  ...ingredients.map(row => ({ ...row, table: 'ingredients' })),
  ...dailyItems.map(row => ({ ...row, table: 'daily_items' }))
]
  .filter(row => row.purchase_item_id && purchases.has(String(row.purchase_item_id)))
  .filter(row => !onlyTable || row.table === onlyTable)

const stockGroups = new Map()
for (const row of stockRows) {
  const key = String(row.purchase_item_id)
  const group = stockGroups.get(key) || []
  group.push(row)
  stockGroups.set(key, group)
}

const duplicates = []
const inconsistent = []
const stockByPurchaseId = new Map()
for (const [key, rows] of stockGroups) {
  const states = rows.map(row => getPurchaseConsumptionState(row.quantity, row.consumed_quantity))
  const first = states[0]
  const sameState = states.every(state =>
    Math.abs(state.consumed_quantity - first.consumed_quantity) < 1e-9 &&
    state.is_fully_consumed === first.is_fully_consumed
  )
  if (rows.length > 1) {
    duplicates.push({ key, names: rows.map(row => row.name_zh || '(未命名)'), sameState })
  }
  if (!sameState) {
    inconsistent.push(key)
    continue
  }
  stockByPurchaseId.set(key, rows[0])
}

const changes = []
const overConsumed = []
for (const [key, stock] of stockByPurchaseId) {
  const purchase = purchases.get(key)
  const next = getPurchaseConsumptionState(stock.quantity, stock.consumed_quantity)
  const currentConsumed = toNumber(purchase.consumed_quantity)
  const currentFull = Boolean(purchase.is_fully_consumed)
  if (toNumber(stock.consumed_quantity) > toNumber(stock.quantity)) {
    overConsumed.push(stock)
  }
  if (Math.abs(currentConsumed - next.consumed_quantity) > 1e-9 || currentFull !== next.is_fully_consumed) {
    changes.push({
      purchaseItemId: purchase.id,
      name: purchase.name_zh || stock.name_zh,
      table: stock.table,
      stockQuantity: toNumber(stock.quantity),
      stockConsumed: toNumber(stock.consumed_quantity),
      currentConsumed,
      currentFull,
      nextConsumed: next.consumed_quantity,
      nextFull: next.is_fully_consumed
    })
  }
}

const dailyCount = changes.filter(c => c.table === 'daily_items').length
const ingredientCount = changes.filter(c => c.table === 'ingredients').length
console.log(`已比对 ${stockByPurchaseId.size} 条有关联小票的库存记录`)
console.log(`待修复 ${changes.length} 条（非食用品 ${dailyCount} 条 / 食材 ${ingredientCount} 条）`)
if (duplicates.length) {
  const sameCount = duplicates.filter(dup => dup.sameState).length
  console.log(`注意：${duplicates.length} 个 purchase_item 被多条库存记录引用（${sameCount} 组状态一致，已合并）`)
  for (const dup of duplicates.filter(item => !item.sameState)) {
    console.warn(`  - 状态不一致已跳过：${dup.key}（${dup.names.join(' / ')}）`)
  }
}
if (inconsistent.length) {
  console.warn(`警告：${inconsistent.length} 个 purchase_item 的多条库存记录状态不一致，已跳过修复，请人工核对`)
}
if (overConsumed.length) {
  console.warn(`注意：${overConsumed.length} 条库存 consumed_quantity > quantity（仅镜像，不做 clamp）：`)
  for (const stock of overConsumed.slice(0, 10)) {
    console.warn(`  - ${stock.name_zh || '(未命名)'}：${toNumber(stock.consumed_quantity)}/${toNumber(stock.quantity)}（${stock.table}）`)
  }
}

const listed = verbose ? changes : changes.slice(0, 20)
for (const change of listed) console.log('  ' + formatChange(change))
if (!verbose && changes.length > listed.length) {
  console.log(`  ... 其余 ${changes.length - listed.length} 条省略，加 --verbose 查看全部`)
}

if (!apply) {
  console.log('预演结束，未写入数据库。确认无误后加 --apply 执行修复。')
  process.exit(0)
}

let updated = 0
const failures = []
for (const [index, change] of changes.entries()) {
  const { error } = await supabase
    .from('purchase_items')
    .update({
      consumed_quantity: change.nextConsumed,
      is_fully_consumed: change.nextFull
    })
    .eq('id', change.purchaseItemId)
  if (error) failures.push({ change, message: error.message })
  else updated += 1
  if ((index + 1) % 20 === 0 || index + 1 === changes.length) {
    console.log(`进度：${index + 1}/${changes.length}`)
  }
}

console.log(`写入完成：成功 ${updated} 条，失败 ${failures.length} 条`)
for (const failure of failures) {
  console.error(`  - ${failure.change.name || failure.change.purchaseItemId}：${failure.message}`)
}

// 修复后复核
const latestPurchases = await fetchAll('purchase_items', 'id, consumed_quantity, is_fully_consumed')
const latestMap = new Map(latestPurchases.map(row => [String(row.id), row]))
const remaining = []
for (const [key, stock] of stockByPurchaseId) {
  const purchase = latestMap.get(key)
  if (!purchase) continue
  const expected = getPurchaseConsumptionState(stock.quantity, stock.consumed_quantity)
  if (
    Math.abs(toNumber(purchase.consumed_quantity) - expected.consumed_quantity) > 1e-9 ||
    Boolean(purchase.is_fully_consumed) !== expected.is_fully_consumed
  ) {
    remaining.push(stock)
  }
}
console.log(`复核：仍有 ${remaining.length} 条不一致`)
if (remaining.length) {
  for (const stock of remaining.slice(0, 20)) {
    console.log(`  - ${stock.name_zh || '(未命名)'}（${stock.table}）`)
  }
  process.exitCode = 1
}


