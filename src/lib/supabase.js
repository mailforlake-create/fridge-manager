import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// 按每批 200 个 id 切片执行 .in() 查询，规避 PostgREST URL 长度限制（约 8KB）
// 用法：batchFetchIn('table', 'id_column', ids, 'select 字段')
// 返回：合并后的行数组（失败时返回空数组并打警告）
export async function batchFetchIn(table, column, ids, select) {
  if (!ids || ids.length === 0) return []
  const BATCH_SIZE = 200
  const batches = []
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    batches.push(ids.slice(i, i + BATCH_SIZE))
  }

  const results = await Promise.all(batches.map(async batch => {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .in(column, batch)
    if (error) {
      console.warn(`[batchFetchIn] ${table}.${column} 查询失败:`, error.message)
      return []
    }
    return data || []
  }))

  return results.flat()
}