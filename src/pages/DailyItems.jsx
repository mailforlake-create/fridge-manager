import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import DailyItemCard from '../components/DailyItemCard'

const UNITS = ['个','包','瓶','袋','盒','卷','片','套']
const CATEGORIES = ['清洁用品','洗护用品','厨房用品','文具','药品','其他']
const LOCATIONS = [['home','家'], ['storage','储物间'], ['bathroom','浴室']]

const EMPTY_FORM = {
  name_zh: '', name_original: '', category: '',
  quantity: 1, unit: '个', location: 'home', memo: ''
}

export default function DailyItems() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [collapsedYears, setCollapsedYears] = useState({})
  const [collapsedMonths, setCollapsedMonths] = useState({})
  const [showConsumed, setShowConsumed] = useState(false)

  useEffect(() => { fetchItems() }, [])

  async function fetchItems() {
    setLoading(true)
    const { data } = await supabase
      .from('daily_items')
      .select(`
        *,
        purchase_item:purchase_item_id (
          price,
          purchase_history:history_id (
            store_name,
            purchased_at
          )
        )
      `)
      .order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }

  async function deleteItem(id) {
    await supabase.from('daily_items').delete().eq('id', id)
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

  async function saveItem() {
    if (!form.name_zh.trim()) return alert('请输入物品名称')
    setSaving(true)
    await supabase.from('daily_items').insert({
      ...form,
      quantity: Number(form.quantity) || 1,
    })
    setSaving(false)
    setAdding(false)
    setForm(EMPTY_FORM)
    fetchItems()
  }

  const categories = ['all', ...new Set(items.map(i => i.category).filter(Boolean))]
  const filtered = items.filter(i => {
    const matchCat = filter === 'all' || i.category === filter
    const matchSearch = !search ||
      i.name_zh?.includes(search) ||
      i.name_original?.includes(search) ||
      i.category?.includes(search)
    const matchConsumed = showConsumed || (i.quantity || 0) > (i.consumed_quantity || 0)
    return matchCat && matchSearch && matchConsumed
  })

  const field = {
    width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 15,
    border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
  }

  return (
    <div style={{ padding: '16px 16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>🧴 非食用品</h1>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>
          {filter === 'all' && !search
            ? `共 ${items.filter(i => (i.quantity||0) > (i.consumed_quantity||0)).length} 件`
            : `${filtered.length} / ${items.filter(i => (i.quantity||0) > (i.consumed_quantity||0)).length} 件`}
        </span>
      </div>

      {/* 搜索框 */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: '#94a3b8', pointerEvents: 'none' }}>🔍</span>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜索物品名称、分类..."
          style={{ width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10, fontSize: 14, border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff', boxSizing: 'border-box' }} />
        {search && (
          <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', color: '#94a3b8', fontSize: 18, lineHeight: 1 }}>×</button>
        )}
      </div>

      {/* 分类筛选 */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12 }}>
        {categories.map(c => (
          <button key={c} onClick={() => setFilter(c)} style={{
            padding: '5px 14px', borderRadius: 99, fontSize: 13, whiteSpace: 'nowrap',
            background: filter === c ? '#3b82f6' : '#f1f5f9',
            color: filter === c ? '#fff' : '#475569', fontWeight: filter === c ? 600 : 400
          }}>{c === 'all' ? '全部' : c}</button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#475569', userSelect: 'none' }}>
          <input type="checkbox" checked={showConsumed}
            onChange={e => setShowConsumed(e.target.checked)}
            style={{ width: 15, height: 15, accentColor: '#3b82f6' }} />
          显示已使用物品
        </label>
        {showConsumed && (
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            含 {items.filter(i => (i.quantity||0) <= (i.consumed_quantity||0)).length} 件已使用
          </span>
        )}
      </div>
      {/* 手动添加表单 */}
      {adding && (
        <div style={{
          background: '#fff', borderRadius: 12, padding: 14, marginBottom: 16,
          border: '2px solid #3b82f6', boxShadow: '0 2px 8px rgba(59,130,246,0.1)'
        }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12, color: '#3b82f6' }}>添加日用品</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input style={field} value={form.name_zh}
              onChange={e => setForm(f => ({ ...f, name_zh: e.target.value }))} placeholder="物品名称*" />
            <input style={field} value={form.name_original}
              onChange={e => setForm(f => ({ ...f, name_original: e.target.value }))} placeholder="原文名称（可选）" />
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>数量</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => setForm(f => ({ ...f, quantity: Math.max(1, Number(f.quantity) - 1) }))}
                    style={{ width: 28, height: 28, borderRadius: 7, background: '#f1f5f9', color: '#475569', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                  <input style={{ ...field, width: 60, textAlign: 'center', padding: '8px 4px' }}
                    type="number" value={form.quantity}
                    onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
                  <button onClick={() => setForm(f => ({ ...f, quantity: Number(f.quantity) + 1 }))}
                    style={{ width: 28, height: 28, borderRadius: 7, background: '#f1f5f9', color: '#475569', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>单位</div>
                <select style={field} value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
                  {UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <select style={field} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              <option value="">选择分类</option>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              {LOCATIONS.map(([v, l]) => (
                <button key={v} onClick={() => setForm(f => ({ ...f, location: v }))} style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13,
                  background: form.location === v ? '#3b82f6' : '#f1f5f9',
                  color: form.location === v ? '#fff' : '#475569',
                  fontWeight: form.location === v ? 600 : 400
                }}>{l}</button>
              ))}
            </div>
            <input style={field} value={form.memo}
              onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="备注（可选）" />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setAdding(false); setForm(EMPTY_FORM) }} style={{
                flex: 1, padding: '10px 0', borderRadius: 10,
                background: '#f1f5f9', color: '#475569', fontSize: 14, fontWeight: 600
              }}>取消</button>
              <button onClick={saveItem} disabled={saving} style={{
                flex: 2, padding: '10px 0', borderRadius: 10,
                background: '#3b82f6', color: '#fff', fontSize: 15, fontWeight: 700
              }}>{saving ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 添加按钮 */}
      {!adding && (
        <button onClick={() => setAdding(true)} style={{
          width: '100%', padding: '11px 0', borderRadius: 10, marginBottom: 16,
          background: '#eff6ff', color: '#3b82f6', fontSize: 14, fontWeight: 600,
          border: '1.5px dashed #93c5fd'
        }}>+ 手动添加非食用品</button>
      )}

      {loading ? (
        <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>加载中...</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>
          {search ? '没有找到匹配的物品' : '暂无日用品，点击上方添加'}
        </p>
      ) : (() => {
        const groupedByYear = {}
        filtered.forEach(item => {
          const dateStr = item.purchase_item?.purchase_history?.purchased_at || item.created_at
          const d = dateStr ? new Date(dateStr) : new Date()
          const yearKey = `${d.getFullYear()}年`
          const monthKey = `${d.getMonth() + 1}月`
          if (!groupedByYear[yearKey]) groupedByYear[yearKey] = {}
          if (!groupedByYear[yearKey][monthKey]) groupedByYear[yearKey][monthKey] = []
          groupedByYear[yearKey][monthKey].push(item)
        })

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {Object.entries(groupedByYear).sort(([a], [b]) => b.localeCompare(a)).map(([year, months]) => {
              const yearItems = Object.values(months).flat()
              const isYearCollapsed = collapsedYears[year]

              return (
                <div key={year} style={{ border: '1px solid #f1f5f9', borderRadius: 12, overflow: 'hidden' }}>
                  <div onClick={() => setCollapsedYears(c => ({ ...c, [year]: !c[year] }))}
                    style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 14px', background: '#f8fafc' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#334155' }}>{year}</span>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>{yearItems.length} 件</span>
                    </div>
                    <span style={{ fontSize: 14, color: '#94a3b8' }}>{isYearCollapsed ? '▼' : '▲'}</span>
                  </div>

                  {!isYearCollapsed && (
                    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {Object.entries(months).sort(([a], [b]) => Number(b.replace('月','')) - Number(a.replace('月',''))).map(([month, monthItems]) => {
                        const monthKey = `${year}-${month}`
                        const isMonthCollapsed = collapsedMonths[monthKey]

                        return (
                          <div key={month}>
                            <div onClick={() => setCollapsedMonths(c => ({ ...c, [monthKey]: !c[monthKey] }))}
                              style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isMonthCollapsed ? 0 : 8, paddingBottom: 5, borderBottom: '1px solid #f1f5f9' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>{month}</span>
                                <span style={{ fontSize: 12, color: '#94a3b8' }}>{monthItems.length} 件</span>
                              </div>
                              <span style={{ fontSize: 13, color: '#94a3b8' }}>{isMonthCollapsed ? '▼' : '▲'}</span>
                            </div>

                            {!isMonthCollapsed && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {monthItems.map(item => (
                                  <DailyItemCard key={item.id} item={item} onDelete={deleteItem} onUpdate={updateItem} />
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}
    </div>
  )
}