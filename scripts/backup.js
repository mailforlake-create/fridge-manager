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
  const query = supabase.from(tableName).select('*')

  // settings 表用 key 排序，其他表用 created_at
  if (tableName === 'settings') {
    query.order('key', { ascending: true })
  } else {
    query.order('created_at', { ascending: true })
  }

  const { data, error } = await query
  if (error) {
    console.error(`  ✗ ${tableName}: ${error.message}`)
    return []
  }
  console.log(`  ✓ ${tableName}: ${data.length} 条`)
  return data
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