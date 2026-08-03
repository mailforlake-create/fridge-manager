import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// 按每批 100 个 id 切片执行 .in() 查询，规避 PostgREST URL 长度限制（约 8KB）；
// 每个切片内部再用 range 分页（每页 1000 行）拉全，规避 max_rows=1000 的静默截断。
// 用法：batchFetchIn('table', 'id_column', ids, 'select 字段')
// 返回：合并后的行数组（失败时返回空数组并打警告）
export async function batchFetchIn(table, column, ids, select) {
  if (!ids || ids.length === 0) return []
  const BATCH_SIZE = 100 // id 切片数量，降低单批命中行数
  const PAGE_SIZE = 1000 // 等于 PostgREST max_rows 上限，一页一页拉

  const batches = []
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    batches.push(ids.slice(i, i + BATCH_SIZE))
  }

  const results = await Promise.all(batches.map(async batch => {
    const all = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .in(column, batch)
        .range(from, from + PAGE_SIZE - 1)
      if (error) {
        console.warn(`[batchFetchIn] ${table}.${column} 查询失败:`, error.message)
        break
      }
      all.push(...(data || []))
      if (!data || data.length < PAGE_SIZE) break // 不足一页说明已取完
      from += PAGE_SIZE
    }
    return all
  }))

  return results.flat()
}
