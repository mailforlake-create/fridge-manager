import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import IngredientCard from '../components/IngredientCard'

const DEMO_FAMILY_ID = 'demo-family-001'

export default function Fridge() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => { fetchItems() }, [])

  async function fetchItems() {
    setLoading(true)
    const { data } = await supabase
      .from('ingredients')
      .select('*')
      .order('expiry_date', { ascending: true })
    setItems(data || [])
    setLoading(false)
  }

  async function deleteItem(id) {
    await supabase.from('ingredients').delete().eq('id', id)
    setItems(items.filter(i => i.id !== id))
  }

  const categories = ['all', ...new Set(items.map(i => i.category).filter(Boolean))]
  const filtered = filter === 'all' ? items : items.filter(i => i.category === filter)

  return (
    <div style={{ padding: '16px 16px 0' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>🧊 我的冰箱</h1>

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
        <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>冰箱是空的，去添加食材吧</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(item => (
            <IngredientCard key={item.id} item={item} onDelete={deleteItem} />
          ))}
        </div>
      )}
    </div>
  )
}