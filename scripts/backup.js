// scripts/backup.js
// 用法：node scripts/backup.js
// 需要先：npm install @supabase/supabase-js dotenv

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
)

// 所有需要备份的表，按依赖顺序排列（父表在前）
const TABLES = [
  'purchase_history',
  'purchase_items',
  'ingredients',
  'daily_items',
  'dining_history',
  'dining_items',
  'dining_photos',
  'settings',
]

async function fetchTable(tableName) {
  const PAGE_SIZE = 1000
  const all = []
  let from = 0

  // settings 表用 key 排序，其他表用 created_at
  const orderColumn = tableName === 'settings' ? 'key' : 'created_at'

  // 分页拉全量：规避 PostgREST 默认 max_rows=1000 的静默截断（超出部分会被丢弃，导致备份不完整）
  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      console.error(`  ✗ ${tableName}: ${error.message}`)
      return []
    }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break // 不足一页说明已取完
    from += PAGE_SIZE
  }

  console.log(`  ✓ ${tableName}: ${all.length} 条`)
  return all
}

async function backup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupDir = join(process.cwd(), 'backups', timestamp)
  mkdirSync(backupDir, { recursive: true })

  console.log(`\n📦 开始备份 → ${backupDir}\n`)

  const manifest = {
    createdAt: new Date().toISOString(),
    tables: {},
  }

  // 逐表导出
  for (const table of TABLES) {
    const data = await fetchTable(table)
    writeFileSync(
      join(backupDir, `${table}.json`),
      JSON.stringify(data, null, 2),
      'utf-8'
    )
    manifest.tables[table] = data.length
  }

  // 写入 manifest
  writeFileSync(
    join(backupDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  )

  console.log(`\n✅ 备份完成`)
  console.log(`   位置：${backupDir}`)
  console.log(`   表数：${TABLES.length}`)
  console.log(`   总计：${Object.values(manifest.tables).reduce((s, n) => s + n, 0)} 条记录`)
}

backup().catch(e => {
  console.error('备份失败：', e.message)
  process.exit(1)
})