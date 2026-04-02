import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function ShoppingList() {
  const [items, setItems] = useState([])
  const [name, setName] = useState('')

  useEffect(() => { fetchItems() }, [])

  async function fetchItems() {
    const { data } = await supabase
      .from('shopping_list')
      .select('*')
      .order('created_at', { ascending: true })
    setItems(data || [])
  }

  async function addItem() {
    if (!name.trim()) return
    const { data } = await supabase
      .from('shopping_list')
      .insert({ name_zh: name.trim() })
      .select().single()
    if (data) setItems([...items, data])
    setName('')
  }

  async function toggleItem(id, done) {
    await supabase.from('shopping_list').update({ is_done: !done }).eq('id', id)
    setItems(items.map(i => i.id === id ? { ...i, is_done: !done } : i))
  }

  async function deleteItem(id) {
    await supabase.from('shopping_list').delete().eq('id', id)
    setItems(items.filter(i => i.id !== id))
  }

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>🛒 购物清单</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addItem()}
          placeholder="添加食材..."
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 10, fontSize: 15,
            border: '1.5px solid #e2e8f0', outline: 'none'
          }} />
        <button onClick={addItem} style={{
          padding: '10px 18px', borderRadius: 10, background: '#16a34a',
          color: '#fff', fontWeight: 600, fontSize: 15
        }}>添加</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map(item => (
          <div key={item.id} style={{
            background: '#fff', borderRadius: 12, padding: '12px 14px',
            display: 'flex', alignItems: 'center', gap: 12,
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            opacity: item.is_done ? 0.5 : 1
          }}>
            <input type="checkbox" checked={item.is_done}
              onChange={() => toggleItem(item.id, item.is_done)}
              style={{ width: 18, height: 18, accentColor: '#16a34a' }} />
            <span style={{
              flex: 1, fontSize: 15,
              textDecoration: item.is_done ? 'line-through' : 'none'
            }}>{item.name_zh}</span>
            <button onClick={() => deleteItem(item.id)} style={{
              background: 'none', color: '#cbd5e1', fontSize: 20, lineHeight: 1
            }}>×</button>
          </div>
        ))}
      </div>
    </div>
  )
}