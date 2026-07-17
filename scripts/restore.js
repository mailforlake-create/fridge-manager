// scripts/restore.js
// 用法：node scripts/restore.js dataBackup/2026-05-01T12-00-00
// 注意：恢复会清空现有数据，谨慎使用

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
)

// 恢复顺序：先删子表，再删父表；先插父表，再插子表
const RESTORE_ORDER = [
  'dining_photos',
  'dining_items',
  'dining_history',
  'daily_items',
  'ingredients',
  'purchase_items',
  'purchase_history',
  'settings',
]

const INSERT_ORDER = RESTORE_ORDER.slice().reverse()

async function restore(backupPath) {
  const manifestPath = join(backupPath, 'manifest.json')
  if (!existsSync(manifestPath)) {
    console.error('找不到备份目录或 manifest.json')
    process.exit(1)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  console.log(`\n📥 恢复备份：${manifest.createdAt}\n`)

  // 按顺序清空表
  console.log('清空现有数据...')
  for (const table of RESTORE_ORDER) {
  // settings 表主键是 key，用不同的清空条件
  const deleteQuery = table === 'settings'
    ? supabase.from(table).delete().neq('key', '')
    : supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')

  const { error } = await deleteQuery
  if (error) console.error(`  ✗ 清空 ${table}: ${error.message}`)
  else console.log(`  ✓ 清空 ${table}`)
}

  // 按顺序插入数据
  console.log('\n插入备份数据...')
  for (const table of INSERT_ORDER) {
    const filePath = join(backupPath, `${table}.json`)
    if (!existsSync(filePath)) { console.log(`  - 跳过 ${table}（文件不存在）`); continue }

    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (!data.length) { console.log(`  - 跳过 ${table}（无数据）`); continue }

    // 分批插入，每批 100 条
    const BATCH = 100
    for (let i = 0; i < data.length; i += BATCH) {
      const batch = data.slice(i, i + BATCH)
      const { error } = await supabase.from(table).insert(batch)
      if (error) { console.error(`  ✗ ${table} 第${i/BATCH+1}批: ${error.message}`); break }
    }
    console.log(`  ✓ ${table}: ${data.length} 条`)
  }

  console.log('\n✅ 恢复完成')
}

const backupPath = process.argv[2]
if (!backupPath) {
  console.error('请指定备份目录，例如：node scripts/restore.js backups/2026-05-01T12-00-00')
  process.exit(1)
}

restore(backupPath).catch(e => {
  console.error('恢复失败：', e.message)
  process.exit(1)
})
