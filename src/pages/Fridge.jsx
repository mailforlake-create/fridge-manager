import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import IngredientCard from '../components/IngredientCard'
import DailyItems from './DailyItems'

export default function Fridge() {
  const [tab, setTab] = useState('food')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => { if (tab === 'food') fetchItems() }, [tab])

  async function fetchItems() {
    setLoading(true)
    const { data } = await supabase
      .from('ingredients')
      .select(`
        *,
        purchase_item:purchase_item_id (
          price,
          original_price,
          is_discount,
          discount_info,
          history_id,
          created_at,
          purchase_history:history_id (
            store_name,
            purchased_at
          )
        )
      `)
      .order('expiry_date', { ascending: true, nullsFirst: false })
    console.log('物品数据样本：', JSON.stringify(data?.[0]))
    setItems((data || []).filter(i => (i.quantity || 0) > (i.consumed_quantity || 0)))
    setLoading(false)
  }

  async function deleteItem(id) {
    await supabase.from('ingredients').delete().eq('id', id)
    setItems(items.filter(i => i.id !== id))
  }

  function updateItem(updated) {
    const remaining = (updated.quantity || 0) - (updated.consumed_quantity || 0)
    if (remaining <= 0) {
      setItems(items.filter(i => i.id !== updated.id))
    } else {
      setItems(items.map(i => i.id === updated.id ? updated : i))
    }
  }

  const categories = ['all', ...new Set(items.map(i => i.category).filter(Boolean))]
  const filtered = items.filter(i => {
    const matchCat = filter === 'all' || i.category === filter
    const matchSearch = !search ||
      i.name_zh?.includes(search) ||
      i.name_original?.includes(search) ||
      i.category?.includes(search)
    return matchCat && matchSearch
  })

  return (
    <div style={{ padding: '16px 16px 0' }}>
      {/* Tab 切换 */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 6, marginBottom: 16,
        background: '#f1f5f9', borderRadius: 12, padding: 4
      }}>
        {[['food','🥦 食品'], ['daily','🧴 日用品']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '9px 0', borderRadius: 9, fontSize: 13, fontWeight: 600,
            background: tab === id ? '#fff' : 'transparent',
            color: tab === id ? (id === 'food' ? '#16a34a' : '#3b82f6') : '#94a3b8',
            boxShadow: tab === id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
          }}>{label}</button>
        ))}
      </div>

      {/* 日用品 Tab */}
      {tab === 'daily' && <DailyItems />}

      {/* 食品 Tab */}
      {tab === 'food' && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>🥦 食品</h1>
            <span style={{ fontSize: 13, color: '#94a3b8' }}>
              {filter === 'all' && !search ? `共 ${items.length} 件` : `${filtered.length} / ${items.length} 件`}
            </span>
          </div>

          <div style={{ position: 'relative', marginBottom: 12 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: '#94a3b8', pointerEvents: 'none' }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索食材名称、分类..."
              style={{ width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10, fontSize: 14, border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff', boxSizing: 'border-box' }} />
            {search && (
              <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', color: '#94a3b8', fontSize: 18, lineHeight: 1 }}>×</button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 16 }}>
            {categories.map(c => (
              <button key={c} onClick={() => setFilter(c)} style={{
                padding: '5px 14px', borderRadius: 99, fontSize: 13, whiteSpace: 'nowrap',
                background: filter === c ? '#16a34a' : '#f1f5f9',
                color: filter === c ? '#fff' : '#475569', fontWeight: filter === c ? 600 : 400
              }}>{c === 'all' ? '全部' : c}</button>
            ))}
          </div>

          {loading ? (
            <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>加载中...</p>
          ) : filtered.length === 0 ? (
            <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>
              {search ? '没有找到匹配的物品' : '食品是空的，去添加食材吧'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map(item => (
                <IngredientCard key={item.id} item={item} onDelete={deleteItem} onUpdate={updateItem} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}