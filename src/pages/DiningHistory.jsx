import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { uploadPhoto, deletePhoto } from '../lib/imageUtils'
import PhotoViewer from '../components/PhotoViewer'

function IngredientPicker({ dinedAt, selected, setSelected, ingredients, loading }) {
  const [ingSearch, setIngSearch] = useState('')
  const [ingFilterStatus, setIngFilterStatus] = useState('active')
  const [ingFilterCategory, setIngFilterCategory] = useState('')
  const [ingFilterStore, setIngFilterStore] = useState('')
  const [ingFilterDate, setIngFilterDate] = useState('')
  const [ingPage, setIngPage] = useState(0)
  const PAGE_SIZE = 8

  const stores = [...new Set(ingredients.map(i => i.purchase_item?.purchase_history?.store_name).filter(Boolean))]
  const categories = [...new Set(ingredients.map(i => i.category).filter(Boolean))]

  const now = new Date(dinedAt)
  const dateRanges = {
    '3d': new Date(now.getTime() - 3 * 86400000).toISOString().split('T')[0],
    '7d': new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0],
    '30d': new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0],
  }

  const filteredIng = ingredients.filter(i => {
    const remaining = (i.quantity || 0) - (i.consumed_quantity || 0)
    if (ingFilterStatus === 'active' && remaining <= 0) return false
    if (ingFilterStatus === 'consumed' && remaining > 0) return false
    if (ingFilterCategory && i.category !== ingFilterCategory) return false
    if (ingFilterStore && i.purchase_item?.purchase_history?.store_name !== ingFilterStore) return false
    const purchasedAt = i.purchase_item?.purchase_history?.purchased_at
    if (ingFilterDate && (!purchasedAt || purchasedAt < dateRanges[ingFilterDate])) return false
    if (ingSearch && !i.name_zh?.includes(ingSearch) && !i.name_original?.includes(ingSearch)) return false
    return true
  })

  const totalPages = Math.ceil(filteredIng.length / PAGE_SIZE)
  const pagedIng = filteredIng.slice(ingPage * PAGE_SIZE, (ingPage + 1) * PAGE_SIZE)

  function calcCost(ing, qty) {
    const price = ing.purchase_item?.price
    if (!price || !qty) return 0
    return Math.round((price * qty / (ing.quantity || 1)) * 10) / 10
  }

  return (
    <div>
      {/* 过滤条件 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        <input value={ingSearch} onChange={e => { setIngSearch(e.target.value); setIngPage(0) }}
          placeholder="搜索食材..."
          style={{ ...smallField }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <select style={{ ...smallField, flex: 1 }} value={ingFilterStatus}
            onChange={e => { setIngFilterStatus(e.target.value); setIngPage(0) }}>
            <option value="active">未食用完</option>
            <option value="consumed">已食用完</option>
            <option value="all">全部</option>
          </select>
          <select style={{ ...smallField, flex: 1 }} value={ingFilterCategory}
            onChange={e => { setIngFilterCategory(e.target.value); setIngPage(0) }}>
            <option value="">全部分类</option>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select style={{ ...smallField, flex: 1 }} value={ingFilterStore}
            onChange={e => { setIngFilterStore(e.target.value); setIngPage(0) }}>
            <option value="">全部商家</option>
            {stores.map(s => <option key={s}>{s}</option>)}
          </select>
          <select style={{ ...smallField, flex: 1 }} value={ingFilterDate}
            onChange={e => { setIngFilterDate(e.target.value); setIngPage(0) }}>
            <option value="">全部日期</option>
            <option value="3d">小票近3天</option>
            <option value="7d">小票近一周</option>
            <option value="30d">小票近一个月</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#94a3b8', fontSize: 13 }}>加载中...</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pagedIng.length === 0 && (
              <div style={{ textAlign: 'center', padding: '16px 0', color: '#94a3b8', fontSize: 13 }}>没有符合条件的食材</div>
            )}
            {pagedIng.map(ing => {
              const remaining = (ing.quantity || 0) - (ing.consumed_quantity || 0)
              const isSelected = !!selected[ing.id]
              const sel = selected[ing.id]
              const cost = isSelected ? calcCost(ing, sel?.qty || 1) : 0
              const storeName = ing.purchase_item?.purchase_history?.store_name
              const purchasedAt = ing.purchase_item?.purchase_history?.purchased_at

              return (
                <div key={ing.id} style={{
                  background: isSelected ? '#f0fdf4' : '#f8fafc',
                  border: `1.5px solid ${isSelected ? '#16a34a' : '#e2e8f0'}`,
                  borderRadius: 10, padding: '9px 11px'
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div onClick={() => {
                      setSelected(s => {
                        if (s[ing.id]) { const n = { ...s }; delete n[ing.id]; return n }
                        return { ...s, [ing.id]: { qty: remaining > 0 ? 1 : 1, updateConsumed: false } }
                      })
                    }} style={{
                      width: 20, height: 20, borderRadius: 5, flexShrink: 0, marginTop: 2, cursor: 'pointer',
                      border: `2px solid ${isSelected ? '#16a34a' : '#cbd5e1'}`,
                      background: isSelected ? '#16a34a' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      {isSelected && <span style={{ color: '#fff', fontSize: 12 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{ing.name_zh}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                        {ing.category && `${ing.category} · `}
                        剩余 {remaining}{ing.unit}
                        {ing.purchase_item?.price && ` · ¥${ing.purchase_item.price}`}
                      </div>
                      {(storeName || purchasedAt) && (
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>
                          {storeName && `🏪 ${storeName}`}
                          {purchasedAt && ` · 📅 ${purchasedAt}`}
                        </div>
                      )}
                      {isSelected && (
                        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button onClick={() => setSelected(s => ({ ...s, [ing.id]: { ...s[ing.id], qty: Math.max(0.1, parseFloat(((s[ing.id]?.qty || 1) - 1).toFixed(1))) } }))}
                              style={{ width: 24, height: 24, borderRadius: 6, background: '#f1f5f9', color: '#475569', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                            <input type="number" step="0.1" value={sel?.qty || 1}
                              onChange={e => setSelected(s => ({ ...s, [ing.id]: { ...s[ing.id], qty: Number(e.target.value) } }))}
                              style={{ width: 55, textAlign: 'center', padding: '3px 6px', borderRadius: 6, border: '1.5px solid #e2e8f0', fontSize: 13, outline: 'none' }} />
                            <span style={{ fontSize: 12, color: '#475569' }}>{ing.unit}</span>
                            <button onClick={() => setSelected(s => ({ ...s, [ing.id]: { ...s[ing.id], qty: parseFloat(((s[ing.id]?.qty || 1) + 1).toFixed(1)) } }))}
                              style={{ width: 24, height: 24, borderRadius: 6, background: '#f1f5f9', color: '#475569', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                            {cost > 0 && <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>¥{cost.toFixed(1)}</span>}
                          </div>
                          {remaining > 0 && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, color: '#475569' }}>
                              <input type="checkbox" checked={sel?.updateConsumed || false}
                                onChange={e => setSelected(s => ({ ...s, [ing.id]: { ...s[ing.id], updateConsumed: e.target.checked } }))}
                                style={{ width: 13, height: 13, accentColor: '#16a34a' }} />
                              同步更新食用量
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <button onClick={() => setIngPage(p => Math.max(0, p - 1))} disabled={ingPage === 0}
                style={{ padding: '5px 10px', borderRadius: 7, background: '#f1f5f9', color: ingPage === 0 ? '#cbd5e1' : '#475569', fontSize: 12 }}>← 上页</button>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{ingPage + 1}/{totalPages}（{filteredIng.length} 件）</span>
              <button onClick={() => setIngPage(p => Math.min(totalPages - 1, p + 1))} disabled={ingPage >= totalPages - 1}
                style={{ padding: '5px 10px', borderRadius: 7, background: '#f1f5f9', color: ingPage >= totalPages - 1 ? '#cbd5e1' : '#475569', fontSize: 12 }}>下页 →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}


const MEAL_TIMES = [
  { id: 'breakfast', label: '早餐', icon: '🌅' },
  { id: 'lunch', label: '午餐', icon: '☀️' },
  { id: 'dinner', label: '晚餐', icon: '🌙' },
  { id: 'snack', label: '点心', icon: '🍪' },
]
const mealOrder = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 }
const mealLabel = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '点心' }
const mealIcon = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍪' }

const smallField = {
  width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13,
  border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
}
const field = {
  width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 15,
  border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
}

// 计算食材成本（按数量比例）
function calcIngredientCost(ingredient, consumedQty) {
  const price = ingredient.purchase_item?.price
  const totalQty = ingredient.quantity || 1
  if (!price || !consumedQty) return 0
  return Math.round((price * consumedQty / totalQty) * 10) / 10
}

// 计算一餐总成本
function calcMealCost(selectedItems) {
  return Object.values(selectedItems).reduce((sum, s) => {
    if (!s.selected) return sum
    return sum + calcIngredientCost(s.ingredient, s.qty)
  }, 0)
}

// ── 菜品详情弹窗 ──────────────────────────────────────────
function DishDetailModal({ item, diningId, photos, onAddPhotos, onDeletePhoto, uploading, onClose, onSaveMemo }) {
  const [memo, setMemo] = useState(item.memo || '')
  const [saving, setSaving] = useState(false)
  const itemPhotos = photos[`${diningId}-item-${item.id}`] || []

  async function save() {
    setSaving(true)
    await supabase.from('dining_items').update({ memo: memo || null }).eq('id', item.id)
    onSaveMemo(item.id, memo)
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{item.name_zh}</div>
          <button onClick={onClose} style={{ background: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
          {item.name_original && <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 4 }}>{item.name_original}</div>}
          <div style={{ fontSize: 14, color: '#475569' }}>
            {item.consumed_quantity || item.quantity}{item.unit}
            {item.price_contribution > 0 && (
              <span style={{ marginLeft: 8, fontWeight: 600, color: '#16a34a' }}>成本 ¥{item.price_contribution}</span>
            )}
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>备注</div>
          <textarea value={memo} onChange={e => setMemo(e.target.value)} placeholder="添加备注..." rows={3}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 14, border: '1.5px solid #e2e8f0', outline: 'none', resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <button onClick={save} disabled={saving} style={{ marginTop: 8, padding: '8px 16px', borderRadius: 8, background: '#f97316', color: '#fff', fontSize: 13, fontWeight: 600 }}>
            {saving ? '保存中...' : '保存备注'}
          </button>
        </div>
        <div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>菜品照片（{itemPhotos.length} 张）</div>
          <PhotoViewer photos={itemPhotos} onAdd={files => onAddPhotos(files, diningId, item.id)} onDelete={onDeletePhoto} uploading={uploading} />
        </div>
      </div>
    </div>
  )
}

// ── 编辑弹窗 ──────────────────────────────────────────────
function EditDiningModal({ record, onClose, onSaved }) {
  const [header, setHeader] = useState({
    meal_time: record.meal_time || null,
    dined_at: record.dined_at,
    dined_time: record.dined_time || '',
    store_name: record.store_name || '',
    store_name_original: record.store_name_original || '',
    amount: record.amount || '',
    memo: record.memo || ''
  })
  const [items, setItems] = useState(
    (record.dining_items || []).map(i => ({ ...i, price: i.price || '', qty_edit: i.consumed_quantity || i.quantity || 1 }))
  )
  const [saving, setSaving] = useState(false)

  // 自炊追加食材
  const [showAddMore, setShowAddMore] = useState(false)
  const [ingredients, setIngredients] = useState([])
  const [addSelected, setAddSelected] = useState({})

  useEffect(() => {
    if (record.dining_type === 'home') fetchIngredients()
  }, [])

async function fetchIngredients() {
  const { data } = await supabase
    .from('ingredients')
    .select(`*, purchase_item:purchase_item_id(price, purchase_history:history_id(store_name, purchased_at))`)
    .order('created_at', { ascending: false })
  setIngredients((data || []).filter(i => {
    const purchasedAt = i.purchase_item?.purchase_history?.purchased_at
    if (!purchasedAt) return true
    return purchasedAt <= record.dined_at
  }))
}

  function calcCost(ing, qty) {
    const price = ing.purchase_item?.price
    if (!price || !qty) return 0
    return Math.round((price * qty / (ing.quantity || 1)) * 10) / 10
  }

  const existingIngIds = new Set(items.map(i => i.ingredient_id).filter(Boolean))

  async function save() {
    setSaving(true)

    await supabase.from('dining_history').update({
      meal_time: header.meal_time || null,
      dined_at: header.dined_at,
      dined_time: header.dined_time || null,
      store_name: header.store_name || null,
      store_name_original: header.store_name_original || null,
      amount: header.amount ? Number(header.amount) : null,
      memo: header.memo || null
    }).eq('id', record.id)

    if (record.dining_type === 'out') {
      await supabase.from('dining_items').delete().eq('dining_id', record.id)
      const validItems = items.filter(i => i.name_zh?.trim())
      if (validItems.length > 0) {
        await supabase.from('dining_items').insert(
          validItems.map(item => ({
            dining_id: record.id,
            name_zh: item.name_zh,
            name_original: item.name_original || null,
            quantity: Number(item.quantity) || 1,
            unit: item.unit || '份',
            price: item.price ? Number(item.price) : null
          }))
        )
      }
    }

    if (record.dining_type === 'home') {
      // 更新现有食材数量
      for (const item of items) {
        if (item.id) {
          await supabase.from('dining_items').update({
            consumed_quantity: Number(item.qty_edit) || item.consumed_quantity,
            price_contribution: item.ingredient_id
              ? calcCost(ingredients.find(i => i.id === item.ingredient_id) || {}, Number(item.qty_edit))
              : null
          }).eq('id', item.id)
        }
      }

      // 追加新食材
      const newItems = Object.entries(addSelected).map(([id, s]) => {
        const ing = ingredients.find(i => i.id === id)
        if (!ing) return null
        return {
          dining_id: record.id,
          name_zh: ing.name_zh,
          name_original: ing.name_original || null,
          category: ing.category || null,
          quantity: ing.quantity,
          unit: ing.unit || '个',
          consumed_quantity: s.qty,
          ingredient_id: id,
          update_consumed: false,
          price_contribution: calcCost(ing, s.qty)
        }
      }).filter(Boolean)
      if (newItems.length > 0) await supabase.from('dining_items').insert(newItems)

      // 重新计算成本
      const allItems = [...items, ...Object.entries(addSelected).map(([id, s]) => {
        const ing = ingredients.find(i => i.id === id)
        return { price_contribution: ing ? calcCost(ing, s.qty) : 0 }
      })]
      const newCost = allItems.reduce((s, i) => s + (i.price_contribution || 0), 0)
      await supabase.from('dining_history').update({ home_cost: Math.round(newCost * 10) / 10 }).eq('id', record.id)
    }

    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 999 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>编辑{record.dining_type === 'home' ? '自炊' : '外食'}记录</div>
          <button onClick={onClose} style={{ background: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>餐次</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
              {MEAL_TIMES.map(m => (
                <button key={m.id} onClick={() => setHeader(h => ({ ...h, meal_time: h.meal_time === m.id ? null : m.id }))} style={{
                  padding: '7px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: header.meal_time === m.id ? '#f97316' : '#f1f5f9',
                  color: header.meal_time === m.id ? '#fff' : '#94a3b8',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
                }}>
                  <span style={{ fontSize: 16 }}>{m.icon}</span>{m.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>日期</div>
              <input style={smallField} type="date" value={header.dined_at} onChange={e => setHeader(h => ({ ...h, dined_at: e.target.value }))} />
            </div>
            {record.dining_type === 'out' && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>时间</div>
                <input style={smallField} type="time" value={header.dined_time} onChange={e => setHeader(h => ({ ...h, dined_time: e.target.value }))} />
              </div>
            )}
          </div>

          {record.dining_type === 'out' && (
            <>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>店名</div>
                <input style={smallField} value={header.store_name} onChange={e => setHeader(h => ({ ...h, store_name: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>金额（¥）</div>
                <input style={smallField} type="number" value={header.amount} onChange={e => setHeader(h => ({ ...h, amount: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>菜品明细</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {items.map((item, i) => (
                    <div key={i} style={{ background: '#f8fafc', borderRadius: 9, padding: '8px 10px' }}>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                        <input style={{ ...smallField, flex: 1 }} value={item.name_zh || ''} onChange={e => setItems(items => { const n=[...items]; n[i]={...n[i],name_zh:e.target.value}; return n })} />
                        <button onClick={() => setItems(items => items.filter((_, j) => j !== i))}
                          style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1 }}>×</button>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>份数</div>
                          <input style={smallField} type="number" value={item.quantity} onChange={e => setItems(items => { const n=[...items]; n[i]={...n[i],quantity:e.target.value}; return n })} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>单价¥</div>
                          <input style={smallField} type="number" value={item.price || ''} onChange={e => setItems(items => { const n=[...items]; n[i]={...n[i],price:e.target.value}; return n })} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={() => setItems(i => [...i, { name_zh: '', quantity: 1, unit: '份', price: '' }])}
                  style={{ marginTop: 7, width: '100%', padding: '7px 0', borderRadius: 8, background: '#f1f5f9', color: '#475569', fontSize: 13, fontWeight: 600 }}>
                  + 添加菜品
                </button>
              </div>
            </>
          )}

          {/* 自炊食材编辑 */}
          {record.dining_type === 'home' && (
            <div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>已选食材</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {items.map((item, i) => (
                  <div key={i} style={{ background: '#f0fdf4', borderRadius: 9, padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{item.name_zh}</div>
                      {item.price_contribution > 0 && (
                        <div style={{ fontSize: 11, color: '#16a34a' }}>成本 ¥{item.price_contribution}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <button onClick={() => setItems(items => { const n=[...items]; n[i]={...n[i],qty_edit:Math.max(0.1,parseFloat(((n[i].qty_edit||1)-1).toFixed(1)))}; return n })}
                        style={{ width: 22, height: 22, borderRadius: 5, background: '#f1f5f9', color: '#475569', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 36, textAlign: 'center' }}>{item.qty_edit}{item.unit}</span>
                      <button onClick={() => setItems(items => { const n=[...items]; n[i]={...n[i],qty_edit:parseFloat(((n[i].qty_edit||1)+1).toFixed(1))}; return n })}
                        style={{ width: 22, height: 22, borderRadius: 5, background: '#f1f5f9', color: '#475569', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                    </div>
                    <button onClick={() => setItems(items => items.filter((_, j) => j !== i))}
                      style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>

              {/* 追加食材 */}
              <button onClick={() => setShowAddMore(!showAddMore)} style={{
                marginTop: 8, width: '100%', padding: '7px 0', borderRadius: 8,
                background: '#f0fdf4', color: '#16a34a', fontSize: 13, fontWeight: 600,
                border: '1px dashed #86efac'
              }}>
                {showAddMore ? '收起' : '+ 追加食材'}
              </button>

              {showAddMore && (
                <div style={{ marginTop: 8 }}>
                  <IngredientPicker
                    dinedAt={record.dined_at}
                    selected={addSelected}
                    setSelected={setAddSelected}
                    ingredients={ingredients.filter(i => !existingIngIds.has(i.id))}
                    loading={false}
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>备注</div>
            <input style={smallField} value={header.memo} onChange={e => setHeader(h => ({ ...h, memo: e.target.value }))} />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '11px 0', borderRadius: 10, background: '#f1f5f9', color: '#475569', fontSize: 14, fontWeight: 600 }}>取消</button>
            <button onClick={save} disabled={saving} style={{ flex: 2, padding: '11px 0', borderRadius: 10, background: '#f97316', color: '#fff', fontSize: 14, fontWeight: 700 }}>{saving ? '保存中...' : '保存'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 食材选择弹窗（自炊用）──────────────────────────────────
function IngredientSelectModal({ diningId, dinedAt, mealTime, existingItems, onClose, onSaved }) {
  const [ingredients, setIngredients] = useState([])
  const [selected, setSelected] = useState({}) // { id: { qty, updateConsumed } }
  const [showConsumed, setShowConsumed] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchIngredients()
    // 预填已有的食材
    if (existingItems?.length) {
      const pre = {}
      existingItems.forEach(item => {
        if (item.ingredient_id) {
          pre[item.ingredient_id] = { qty: item.consumed_quantity || item.quantity || 1, updateConsumed: item.update_consumed || false, existingItemId: item.id }
        }
      })
      setSelected(pre)
    }
  }, [])

  async function fetchIngredients() {
    const { data } = await supabase
      .from('ingredients')
      .select(`*, purchase_item:purchase_item_id(price, original_price, purchase_history:history_id(purchased_at))`)
      .lte('created_at', `${dinedAt}T23:59:59`)
      .order('created_at', { ascending: false })
    setIngredients(data || [])
  }

  const filtered = ingredients.filter(i =>
    showConsumed ? true : (i.quantity || 0) > (i.consumed_quantity || 0)
  )

  function toggleSelect(ing) {
    setSelected(s => {
      if (s[ing.id]) {
        const next = { ...s }
        delete next[ing.id]
        return next
      }
      const remaining = (ing.quantity || 1) - (ing.consumed_quantity || 0)
      return { ...s, [ing.id]: { qty: remaining > 0 ? 1 : 1, updateConsumed: false, existingItemId: null } }
    })
  }

  const totalCost = Object.entries(selected).reduce((sum, [id, s]) => {
    const ing = ingredients.find(i => i.id === id)
    if (!ing) return sum
    return sum + calcIngredientCost(ing, s.qty)
  }, 0)

  async function save() {
    setSaving(true)
    const entries = Object.entries(selected)

    for (const [ingId, s] of entries) {
      const ing = ingredients.find(i => i.id === ingId)
      if (!ing) continue
      const cost = calcIngredientCost(ing, s.qty)

      if (s.existingItemId) {
        // 更新已有记录
        await supabase.from('dining_items').update({
          consumed_quantity: s.qty,
          update_consumed: s.updateConsumed,
          price_contribution: cost
        }).eq('id', s.existingItemId)
      } else {
        // 新增
        await supabase.from('dining_items').insert({
          dining_id: diningId,
          name_zh: ing.name_zh,
          name_original: ing.name_original || null,
          category: ing.category || null,
          quantity: ing.quantity,
          unit: ing.unit || '个',
          consumed_quantity: s.qty,
          ingredient_id: ingId,
          update_consumed: s.updateConsumed,
          price_contribution: cost
        })
      }

      // 更新食材消耗
      if (s.updateConsumed) {
        const newConsumed = Math.min(
          (ing.consumed_quantity || 0) + s.qty,
          ing.quantity || 0
        )
        const isFullyConsumed = newConsumed >= (ing.quantity || 0)
        await supabase.from('ingredients').update({ consumed_quantity: newConsumed }).eq('id', ingId)
        if (ing.purchase_item_id && isFullyConsumed) {
          await supabase.from('purchase_items').update({ is_fully_consumed: true, consumed_quantity: newConsumed }).eq('id', ing.purchase_item_id)
        }
      }
    }

    // 更新自炊成本
    await supabase.from('dining_history').update({ home_cost: Math.round(totalCost * 10) / 10 }).eq('id', diningId)

    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>选择食材</div>
          <button onClick={onClose} style={{ background: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>
          仅显示 {dinedAt} 当天及之前入库的食用品
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#475569', marginBottom: 12 }}>
          <input type="checkbox" checked={showConsumed} onChange={e => setShowConsumed(e.target.checked)}
            style={{ width: 15, height: 15, accentColor: '#16a34a' }} />
          显示已食用完的食品
        </label>

        {Object.keys(selected).length > 0 && (
          <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>
            已选 {Object.keys(selected).length} 种食材
            {totalCost > 0 && <span style={{ marginLeft: 8, fontWeight: 600, color: '#16a34a' }}>预计成本 ¥{totalCost.toFixed(1)}</span>}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {filtered.map(ing => {
            const remaining = (ing.quantity || 0) - (ing.consumed_quantity || 0)
            const isSelected = !!selected[ing.id]
            const sel = selected[ing.id]
            const cost = isSelected ? calcIngredientCost(ing, sel?.qty || 1) : 0

            return (
              <div key={ing.id} style={{
                background: isSelected ? '#f0fdf4' : '#f8fafc',
                border: `1.5px solid ${isSelected ? '#16a34a' : '#e2e8f0'}`,
                borderRadius: 12, padding: '10px 12px'
              }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div onClick={() => toggleSelect(ing)} style={{
                    width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 2, cursor: 'pointer',
                    border: `2px solid ${isSelected ? '#16a34a' : '#cbd5e1'}`,
                    background: isSelected ? '#16a34a' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    {isSelected && <span style={{ color: '#fff', fontSize: 13 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{ing.name_zh}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>
                      剩余 {remaining}{ing.unit}
                      {ing.purchase_item?.price && ` · ¥${ing.purchase_item.price}/${ing.quantity}${ing.unit}`}
                    </div>
                    {isSelected && (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontSize: 12, color: '#475569', width: 60 }}>使用量</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button onClick={() => setSelected(s => ({ ...s, [ing.id]: { ...s[ing.id], qty: Math.max(0.1, (s[ing.id]?.qty || 1) - 1) } }))}
                              style={{ width: 26, height: 26, borderRadius: 6, background: '#f1f5f9', color: '#475569', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                            <input type="number" value={sel?.qty || 1} step="0.1"
                              onChange={e => setSelected(s => ({ ...s, [ing.id]: { ...s[ing.id], qty: Number(e.target.value) } }))}
                              style={{ width: 60, textAlign: 'center', ...smallField }} />
                            <span style={{ fontSize: 13, color: '#475569' }}>{ing.unit}</span>
                            <button onClick={() => setSelected(s => ({ ...s, [ing.id]: { ...s[ing.id], qty: Math.min(ing.quantity || 99, (s[ing.id]?.qty || 1) + 1) } }))}
                              style={{ width: 26, height: 26, borderRadius: 6, background: '#f1f5f9', color: '#475569', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                          </div>
                          {cost > 0 && <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>¥{cost.toFixed(1)}</span>}
                        </div>
                        {remaining > 0 && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#475569' }}>
                            <input type="checkbox" checked={sel?.updateConsumed || false}
                              onChange={e => setSelected(s => ({ ...s, [ing.id]: { ...s[ing.id], updateConsumed: e.target.checked } }))}
                              style={{ width: 14, height: 14, accentColor: '#16a34a' }} />
                            同步更新食用量
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <button onClick={save} disabled={saving || Object.keys(selected).length === 0} style={{
          width: '100%', padding: '13px 0', borderRadius: 12,
          background: Object.keys(selected).length > 0 ? '#16a34a' : '#e2e8f0',
          color: Object.keys(selected).length > 0 ? '#fff' : '#94a3b8',
          fontSize: 15, fontWeight: 700
        }}>{saving ? '保存中...' : `保存（${Object.keys(selected).length} 种食材${totalCost > 0 ? '，成本 ¥' + totalCost.toFixed(1) : ''}）`}</button>
      </div>
    </div>
  )
}

// ── 录入弹窗 ──────────────────────────────────────────────
function AddDiningModal({ onClose, onSaved }) {
  const [diningType, setDiningType] = useState(null)
  const [mealTime, setMealTime] = useState(null)
  const [dinedAt, setDinedAt] = useState(new Date().toISOString().split('T')[0])
  const [dinedTime, setDinedTime] = useState('')
  const [memo, setMemo] = useState('')

  // 自炊食材选择
  const [homeSelected, setHomeSelected] = useState({})
  const [ingredients, setIngredients] = useState([])
  const [loadingIng, setLoadingIng] = useState(false)

  // 外食
  const [outMode, setOutMode] = useState(null)
  const [storeName, setStoreName] = useState('')
  const [storeNameOriginal, setStoreNameOriginal] = useState('')
  const [amount, setAmount] = useState('')
  const [outItems, setOutItems] = useState([])
  const [billData, setBillData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

  async function callAI(messages) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/claude-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ max_tokens: 4096, messages })
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data.content[0].text
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  function parseJSON(text) {
    try {
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
      if (match) return JSON.parse(match[0])
    } catch {}
    return null
  }

  useEffect(() => {
    if (diningType === 'home') fetchIngredients()
  }, [diningType, dinedAt])

async function fetchIngredients() {
  setLoadingIng(true)
  const { data } = await supabase
    .from('ingredients')
    .select(`*, purchase_item:purchase_item_id(price, purchase_history:history_id(store_name, purchased_at))`)
    .order('created_at', { ascending: false })
  // 只保留小票日期 <= 餐食日期的食材（没有小票日期的也显示）
  setIngredients((data || []).filter(i => {
    const purchasedAt = i.purchase_item?.purchase_history?.purchased_at
    if (!purchasedAt) return true // 手动添加的没有小票日期，允许显示
    return purchasedAt <= dinedAt
  }))
  setLoadingIng(false)
}

  function calcCost(ing, qty) {
    const price = ing.purchase_item?.price
    if (!price || !qty) return 0
    return Math.round((price * qty / (ing.quantity || 1)) * 10) / 10
  }

  const totalHomeCost = Object.entries(homeSelected).reduce((sum, [id, s]) => {
    const ing = ingredients.find(i => i.id === id)
    if (!ing) return sum
    return sum + calcCost(ing, s.qty)
  }, 0)

  async function recognizeBill(files) {
    setLoading(true)
    try {
      const parts = []
      for (const file of files) {
        const base64 = await fileToBase64(file)
        parts.push({ type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: base64 } })
      }
      parts.push({ type: 'text', text: `识别这张餐饮账单（支持中日英文），输出JSON：{"store_name":"店名中文","store_name_original":"店名原文","dined_at":"YYYY-MM-DD或空","dined_time":"HH:MM或空","amount":合计或null,"items":[{"name_zh":"菜品中文名","name_original":"原文","quantity":数量,"unit":"份","price":单价或null}]}只输出JSON。` })
      const text = await callAI([{ role: 'user', content: parts }])
      const result = parseJSON(text)
      if (result) {
        setBillData(result)
        setStoreName(result.store_name || '')
        setStoreNameOriginal(result.store_name_original || '')
        if (result.dined_at) setDinedAt(result.dined_at)
        if (result.dined_time) setDinedTime(result.dined_time)
        if (result.amount) setAmount(String(result.amount))
        setOutItems((result.items || []).map(i => ({ ...i, price: i.price || '' })))
      }
    } catch (e) { alert('识别失败：' + e.message) }
    setLoading(false)
  }

  async function recognizeOutDish(files) {
    setLoading(true)
    try {
      const parts = []
      for (const file of files) {
        const base64 = await fileToBase64(file)
        parts.push({ type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: base64 } })
      }
      parts.push({ type: 'text', text: `识别图片中的餐厅菜品（支持中日英文），输出JSON数组：[{"name_zh":"中文名","name_original":"原文","quantity":1,"unit":"份"}]只输出JSON数组。` })
      const text = await callAI([{ role: 'user', content: parts }])
      const result = parseJSON(text)
      if (Array.isArray(result)) setOutItems(prev => [...prev, ...result.map(i => ({ ...i, price: '' }))])
    } catch (e) { alert('识别失败：' + e.message) }
    setLoading(false)
  }

  const setOutItemField = useCallback((i, k, v) => {
    setOutItems(items => { const n = [...items]; n[i] = { ...n[i], [k]: v }; return n })
  }, [])

  const canSave = diningType && (
    diningType === 'home' ? mealTime : (storeName.trim() && dinedAt && amount)
  )

  async function save() {
    if (diningType === 'out' && (!storeName.trim() || !dinedAt || !amount)) {
      return alert('外食记录需要填写店名、就餐日期和金额')
    }
    setSaving(true)
    const { data: dining } = await supabase.from('dining_history').insert({
      dining_type: diningType,
      meal_time: mealTime || null,
      dined_at: dinedAt,
      dined_time: diningType === 'out' ? (dinedTime || null) : null,
      store_name: diningType === 'out' ? storeName : null,
      store_name_original: diningType === 'out' ? storeNameOriginal : null,
      amount: diningType === 'out' && amount ? Number(amount) : null,
      home_cost: diningType === 'home' && totalHomeCost > 0 ? Math.round(totalHomeCost * 10) / 10 : null,
      memo: memo || null
    }).select().single()

    if (dining) {
      if (diningType === 'out' && outItems.length > 0) {
        await supabase.from('dining_items').insert(
          outItems.filter(i => i.name_zh?.trim()).map(item => ({
            dining_id: dining.id,
            name_zh: item.name_zh,
            name_original: item.name_original || null,
            quantity: Number(item.quantity) || 1,
            unit: item.unit || '份',
            price: item.price ? Number(item.price) : null
          }))
        )
      }

      if (diningType === 'home' && Object.keys(homeSelected).length > 0) {
        const items = Object.entries(homeSelected).map(([id, s]) => {
          const ing = ingredients.find(i => i.id === id)
          if (!ing) return null
          return {
            dining_id: dining.id,
            name_zh: ing.name_zh,
            name_original: ing.name_original || null,
            category: ing.category || null,
            quantity: ing.quantity,
            unit: ing.unit || '个',
            consumed_quantity: s.qty,
            ingredient_id: id,
            update_consumed: s.updateConsumed || false,
            price_contribution: calcCost(ing, s.qty)
          }
        }).filter(Boolean)
        if (items.length > 0) await supabase.from('dining_items').insert(items)

        // 更新消耗量
        for (const [id, s] of Object.entries(homeSelected)) {
          if (!s.updateConsumed) continue
          const ing = ingredients.find(i => i.id === id)
          if (!ing) continue
          const newConsumed = Math.min((ing.consumed_quantity || 0) + s.qty, ing.quantity || 0)
          const isFully = newConsumed >= (ing.quantity || 0)
          await supabase.from('ingredients').update({ consumed_quantity: newConsumed }).eq('id', id)
          if (ing.purchase_item_id && isFully) {
            await supabase.from('purchase_items').update({ is_fully_consumed: true, consumed_quantity: newConsumed }).eq('id', ing.purchase_item_id)
          }
        }
      }
    }

    setSaving(false)
    onSaved()
    onClose()
  }


  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430, maxHeight: '95vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>记录餐饮</div>
          <button onClick={onClose} style={{ background: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        {/* 日期 */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>就餐日期</div>
          <input style={field} type="date" value={dinedAt} onChange={e => { setDinedAt(e.target.value); setIngPage(0) }} />
        </div>

        {/* 餐次 */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>餐次{diningType === 'out' ? '（可选）' : '*'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
            {MEAL_TIMES.map(m => (
              <button key={m.id} onClick={() => setMealTime(mealTime === m.id ? null : m.id)} style={{
                padding: '8px 0', borderRadius: 9, fontSize: 12, fontWeight: 600,
                background: mealTime === m.id ? '#f97316' : '#f1f5f9',
                color: mealTime === m.id ? '#fff' : '#94a3b8',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
              }}>
                <span style={{ fontSize: 18 }}>{m.icon}</span>{m.label}
              </button>
            ))}
          </div>
        </div>

        {/* 类型 */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>类型</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[['home','🍳 自炊'],['out','🍽️ 外食']].map(([id, label]) => (
              <button key={id} onClick={() => { setDiningType(id); setOutMode(null) }} style={{
                padding: '12px 0', borderRadius: 10, fontSize: 14, fontWeight: 600,
                background: diningType === id ? (id === 'home' ? '#16a34a' : '#f97316') : '#f1f5f9',
                color: diningType === id ? '#fff' : '#94a3b8'
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* 自炊：直接选食材 */}
        {diningType === 'home' && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 8 }}>
              选择食材
              {Object.keys(homeSelected).length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 12, color: '#16a34a' }}>
                  已选 {Object.keys(homeSelected).length} 种
                  {totalHomeCost > 0 && `，成本 ¥${totalHomeCost.toFixed(1)}`}
                </span>
              )}
            </div>
            <IngredientPicker
              dinedAt={dinedAt}
              selected={homeSelected}
              setSelected={setHomeSelected}
              ingredients={ingredients}
              loading={loadingIng}
            />
          </div>
        )}

        {/* 外食（保持原有逻辑不变） */}
        {diningType === 'out' && (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>录入方式</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[['bill','🧾 账单拍照'],['dish','📷 菜品拍照']].map(([id, label]) => (
                  <button key={id} onClick={() => setOutMode(id)} style={{
                    padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 600,
                    background: outMode === id ? '#f97316' : '#f1f5f9',
                    color: outMode === id ? '#fff' : '#94a3b8'
                  }}>{label}</button>
                ))}
              </div>
            </div>

            {outMode === 'bill' && (
              <div style={{ marginBottom: 14 }}>
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: '#f97316' }}><div style={{ fontSize: 24 }}>✨</div>识别中...</div>
                ) : !billData ? (
                  <div>
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }} id="bill-input"
                      onChange={e => recognizeBill(Array.from(e.target.files))} />
                    <button onClick={() => document.getElementById('bill-input').click()} style={{
                      width: '100%', padding: '24px 0', borderRadius: 12, border: '2px dashed #fed7aa',
                      background: '#fff7ed', color: '#9a3412', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6
                    }}>
                      <span style={{ fontSize: 32 }}>🧾</span>
                      <span style={{ fontWeight: 600 }}>拍摄或选择账单照片</span>
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ background: '#fff7ed', borderRadius: 10, padding: '8px 12px', fontSize: 13, color: '#9a3412' }}>已识别账单</div>
                    {outItems.map((item, i) => (
                      <div key={i} style={{ background: '#f8fafc', borderRadius: 9, padding: '8px 10px' }}>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                          <input style={{ ...smallField, flex: 1 }} value={item.name_zh} onChange={e => setOutItemField(i, 'name_zh', e.target.value)} />
                          <button onClick={() => setOutItems(items => items.filter((_, j) => j !== i))}
                            style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1 }}>×</button>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>份数</div>
                            <input style={smallField} type="number" value={item.quantity || 1} onChange={e => setOutItemField(i, 'quantity', e.target.value)} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>单价¥</div>
                            <input style={smallField} type="number" value={item.price || ''} onChange={e => setOutItemField(i, 'price', e.target.value)} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>小计</div>
                            <div style={{ padding: '6px 7px', borderRadius: 7, background: '#fff', border: '1.5px solid #e2e8f0', fontSize: 13, fontWeight: 600, color: '#f97316' }}>
                              {item.price && item.quantity ? `¥${(Number(item.price)*Number(item.quantity)).toFixed(0)}` : '-'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => { setBillData(null); setOutItems([]) }}
                      style={{ padding: '6px 0', borderRadius: 7, background: '#f1f5f9', color: '#475569', fontSize: 13 }}>重新识别</button>
                  </div>
                )}
              </div>
            )}

            {outMode === 'dish' && (
              <div style={{ marginBottom: 14 }}>
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: '#f97316' }}><div style={{ fontSize: 24 }}>✨</div>识别中...</div>
                ) : (
                  <div>
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }} id="out-dish-input"
                      onChange={e => recognizeOutDish(Array.from(e.target.files))} />
                    <button onClick={() => document.getElementById('out-dish-input').click()} style={{
                      width: '100%', padding: '20px 0', borderRadius: 12, border: '2px dashed #fed7aa',
                      background: '#fff7ed', color: '#9a3412', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      marginBottom: outItems.length ? 8 : 0
                    }}>
                      <span style={{ fontSize: 28 }}>📷</span>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{outItems.length ? '继续添加照片' : '拍摄或选择菜品照片'}</span>
                    </button>
                    {outItems.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {outItems.map((item, i) => (
                          <div key={i} style={{ display: 'flex', gap: 6 }}>
                            <input style={{ ...smallField, flex: 1 }} value={item.name_zh} onChange={e => setOutItemField(i, 'name_zh', e.target.value)} />
                            <button onClick={() => setOutItems(items => items.filter((_, j) => j !== i))}
                              style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1 }}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>店名、日期、金额为必填项</div>
              <input style={field} value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="店名（中文）*" />
              <input style={field} value={storeNameOriginal} onChange={e => setStoreNameOriginal(e.target.value)} placeholder="店名原文（可选）" />
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...field, flex: 1 }} type="date" value={dinedAt} onChange={e => setDinedAt(e.target.value)} />
                <input style={{ ...field, flex: 1 }} type="time" value={dinedTime} onChange={e => setDinedTime(e.target.value)} />
              </div>
              <input style={field} type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="金额（¥）*" />
            </div>
          </>
        )}

        <div style={{ marginBottom: 14 }}>
          <input style={field} value={memo} onChange={e => setMemo(e.target.value)} placeholder="备注（可选）" />
        </div>

        <button onClick={save} disabled={!canSave || saving} style={{
          width: '100%', padding: '13px 0', borderRadius: 12,
          background: canSave ? (diningType === 'home' ? '#16a34a' : '#f97316') : '#e2e8f0',
          color: canSave ? '#fff' : '#94a3b8', fontSize: 15, fontWeight: 700
        }}>{saving ? '保存中...' : '保存记录'}</button>
      </div>
    </div>
  )
}

// ── 主页面 ────────────────────────────────────────────────
export default function DiningHistory() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [expanded, setExpanded] = useState({})
  const [collapsedYears, setCollapsedYears] = useState({})
  const [collapsedMonths, setCollapsedMonths] = useState({})
  const [editingRecord, setEditingRecord] = useState(null)
  const [detailItem, setDetailItem] = useState(null)
  const [selectingIngredients, setSelectingIngredients] = useState(null) // { diningId, dinedAt, mealTime, existingItems }
  const [photos, setPhotos] = useState({})
  const [uploadingKey, setUploadingKey] = useState(null)
  const [filterType, setFilterType] = useState('all') // all | home | out

  useEffect(() => { fetchRecords() }, [])

  async function fetchRecords() {
    setLoading(true)
    const { data } = await supabase
      .from('dining_history')
      .select(`*, dining_items(*)`)
      .order('dined_at', { ascending: false })
    setRecords(data || [])
    if (data?.length) await fetchPhotos(data.map(r => r.id))
    setLoading(false)
  }

  async function fetchPhotos(diningIds) {
    if (!diningIds.length) return
    const { data } = await supabase.from('dining_photos').select('*').in('dining_id', diningIds)
    if (!data) return
    const map = {}
    data.forEach(p => {
      const key = p.dining_item_id ? `${p.dining_id}-item-${p.dining_item_id}` : p.dining_id
      if (!map[key]) map[key] = []
      map[key].push(p)
    })
    setPhotos(map)
  }

  async function handleAddPhotos(files, diningId, itemId = null) {
    const key = itemId ? `${diningId}-item-${itemId}` : diningId
    setUploadingKey(key)
    try {
      const folder = itemId ? `dining/${diningId}/items` : `dining/${diningId}`
      const newPhotos = []
      for (const file of files) {
        const { filePath, url } = await uploadPhoto(supabase, file, folder)
        const { data } = await supabase.from('dining_photos').insert({
          dining_id: diningId, dining_item_id: itemId || null, file_path: filePath, url
        }).select().single()
        if (data) newPhotos.push(data)
      }
      setPhotos(prev => ({ ...prev, [key]: [...(prev[key] || []), ...newPhotos] }))
    } catch (e) { alert('上传失败：' + e.message) }
    setUploadingKey(null)
  }

  async function handleDeletePhoto(photo) {
    try {
      await deletePhoto(supabase, photo.file_path)
      await supabase.from('dining_photos').delete().eq('id', photo.id)
      const key = photo.dining_item_id ? `${photo.dining_id}-item-${photo.dining_item_id}` : photo.dining_id
      setPhotos(prev => ({ ...prev, [key]: (prev[key] || []).filter(p => p.id !== photo.id) }))
    } catch (e) { alert('删除失败：' + e.message) }
  }

  async function deleteRecord(id) {
    await supabase.from('dining_history').delete().eq('id', id)
    setRecords(records.filter(r => r.id !== id))
  }

  function handleSaveMemo(itemId, memo) {
    setRecords(records.map(r => ({
      ...r,
      dining_items: r.dining_items?.map(i => i.id === itemId ? { ...i, memo } : i)
    })))
  }

  function handleIngredientsSaved() {
    fetchRecords()
  }

  const filtered = records.filter(r => {
    if (filterType !== 'all' && r.dining_type !== filterType) return false
    if (!search) return true
    const s = search.toLowerCase()
    return r.store_name?.toLowerCase().includes(s) ||
      r.memo?.toLowerCase().includes(s) ||
      r.dining_items?.some(i => i.name_zh?.toLowerCase().includes(s))
  })

  // 按年月分组
  const groupedByYear = {}
  filtered.forEach(r => {
    const d = new Date(r.dined_at)
    const yearKey = `${d.getFullYear()}年`
    const monthKey = `${d.getMonth() + 1}月`
    if (!groupedByYear[yearKey]) groupedByYear[yearKey] = {}
    if (!groupedByYear[yearKey][monthKey]) groupedByYear[yearKey][monthKey] = {}
    const dayKey = r.dined_at
    if (!groupedByYear[yearKey][monthKey][dayKey]) groupedByYear[yearKey][monthKey][dayKey] = []
    groupedByYear[yearKey][monthKey][dayKey].push(r)
  })

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>🍽️ 餐饮履历</h1>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>共 {filtered.length} 条</span>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ padding: '7px 16px', borderRadius: 10, background: '#f97316', color: '#fff', fontSize: 14, fontWeight: 600 }}>+ 记录</button>
      </div>

      <div style={{ position: 'relative', marginBottom: 16 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: '#94a3b8', pointerEvents: 'none' }}>🔍</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索店名、食材..."
          style={{ width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10, fontSize: 14, border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff', boxSizing: 'border-box' }} />
        {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', color: '#94a3b8', fontSize: 18, lineHeight: 1 }}>×</button>}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
        gap: 5, marginBottom: 14,
        background: '#f1f5f9', borderRadius: 10, padding: 3
      }}>
        {[['all','全部'],['home','🍳 自炊'],['out','🍽️ 外食']].map(([id, label]) => (
          <button key={id} onClick={() => setFilterType(id)} style={{
            padding: '7px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: filterType === id ? '#fff' : 'transparent',
            color: filterType === id
              ? (id === 'home' ? '#16a34a' : id === 'out' ? '#f97316' : '#334155')
              : '#94a3b8',
            boxShadow: filterType === id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
          }}>{label}</button>
        ))}
      </div>
      {loading ? (
        <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>加载中...</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>
          {search ? '没有找到匹配的记录' : '暂无餐饮记录，点击右上角开始记录'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Object.entries(groupedByYear).map(([year, months]) => {
            const yearRecords = Object.values(months).flatMap(m => Object.values(m).flat())
            const yearOutTotal = yearRecords.filter(r => r.dining_type === 'out').reduce((s, r) => s + (r.amount || 0), 0)
            const yearHomeTotal = yearRecords.filter(r => r.dining_type === 'home').reduce((s, r) => s + (r.home_cost || 0), 0)
            const isYearCollapsed = collapsedYears[year]

            return (
              <div key={year} style={{ border: '1px solid #f1f5f9', borderRadius: 12, overflow: 'hidden' }}>
                <div onClick={() => setCollapsedYears(c => ({ ...c, [year]: !c[year] }))}
                  style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f8fafc' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#334155' }}>{year}</span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>{yearRecords.length} 条</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {yearHomeTotal > 0 && <span style={{ fontSize: 12, color: '#16a34a' }}>自炊 ¥{yearHomeTotal.toFixed(0)}</span>}
                    {yearOutTotal > 0 && <span style={{ fontSize: 12, color: '#f97316' }}>外食 ¥{yearOutTotal.toLocaleString()}</span>}
                    <span style={{ fontSize: 14, color: '#94a3b8' }}>{isYearCollapsed ? '▼' : '▲'}</span>
                  </div>
                </div>

                {!isYearCollapsed && (
                  <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {Object.entries(months).map(([month, days]) => {
                      const monthRecords = Object.values(days).flat()
                      const monthOutTotal = monthRecords.filter(r => r.dining_type === 'out').reduce((s, r) => s + (r.amount || 0), 0)
                      const monthHomeTotal = monthRecords.filter(r => r.dining_type === 'home').reduce((s, r) => s + (r.home_cost || 0), 0)
                      const monthKey = `${year}-${month}`
                      const isMonthCollapsed = collapsedMonths[monthKey]

                      return (
                        <div key={month}>
                          <div onClick={() => setCollapsedMonths(c => ({ ...c, [monthKey]: !c[monthKey] }))}
                            style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isMonthCollapsed ? 0 : 8, paddingBottom: 6, borderBottom: '1.5px solid #f1f5f9' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>{month}</span>
                              <span style={{ fontSize: 12, color: '#94a3b8' }}>{monthRecords.length} 条</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {monthHomeTotal > 0 && <span style={{ fontSize: 12, color: '#16a34a' }}>自炊 ¥{monthHomeTotal.toFixed(0)}</span>}
                              {monthOutTotal > 0 && <span style={{ fontSize: 12, color: '#f97316' }}>外食 ¥{monthOutTotal.toLocaleString()}</span>}
                              <span style={{ fontSize: 13, color: '#94a3b8' }}>{isMonthCollapsed ? '▼' : '▲'}</span>
                            </div>
                          </div>

                          {!isMonthCollapsed && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              {Object.entries(days).sort(([a], [b]) => b.localeCompare(a)).map(([day, dayRecords]) => (
                                <div key={day}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                                    {new Date(day).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })}
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {[...dayRecords].sort((a, b) => (mealOrder[a.meal_time] ?? 4) - (mealOrder[b.meal_time] ?? 4)).map(r => (
                                      <div key={r.id} style={{
                                        background: '#fff', borderRadius: 12, overflow: 'hidden',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                                        borderLeft: `4px solid ${r.dining_type === 'home' ? '#16a34a' : '#f97316'}`
                                      }}>
                                        {/* 头部 */}
                                        <div style={{ padding: '12px 14px' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setExpanded(e => ({ ...e, [r.id]: !e[r.id] }))}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {r.meal_time && <><span style={{ fontSize: 16 }}>{mealIcon[r.meal_time]}</span><span style={{ fontWeight: 600, fontSize: 14 }}>{mealLabel[r.meal_time]}</span></>}
                                                <span style={{
                                                  fontSize: 11, padding: '1px 7px', borderRadius: 99, fontWeight: 600,
                                                  background: r.dining_type === 'home' ? '#f0fdf4' : '#fff7ed',
                                                  color: r.dining_type === 'home' ? '#16a34a' : '#f97316'
                                                }}>{r.dining_type === 'home' ? '自炊' : '外食'}</span>
                                              </div>
                                              {r.store_name && (
                                                <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
                                                  🏪 {r.store_name}
                                                  {r.dined_time && <span style={{ marginLeft: 6, color: '#94a3b8' }}>⏰ {r.dined_time}</span>}
                                                  {r.amount && <span style={{ marginLeft: 8, fontWeight: 600, color: '#f97316' }}>¥{r.amount}</span>}
                                                </div>
                                              )}
                                              {r.dining_type === 'home' && r.home_cost > 0 && (
                                                <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, marginTop: 4 }}>
                                                  成本 ¥{r.home_cost.toFixed(1)}
                                                </div>
                                              )}
                                              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                                                {r.dining_items?.length > 0 ? `${r.dining_items.length} ${r.dining_type === 'home' ? '种食材' : '道菜品'}` : '无明细'}
                                                {(photos[r.id]?.length > 0) && ` · 📷 ${photos[r.id].length} 张`}
                                              </div>
                                              {r.memo && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>备注：{r.memo}</div>}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                              <button onClick={() => setEditingRecord(r)} style={{ background: '#f1f5f9', color: '#475569', fontSize: 13, padding: '5px 10px', borderRadius: 7, fontWeight: 600 }}>编辑</button>
                                              <button onClick={() => deleteRecord(r.id)} style={{ background: '#fef2f2', color: '#ef4444', fontSize: 13, padding: '5px 10px', borderRadius: 7, fontWeight: 600 }}>删除</button>
                                              <div onClick={() => setExpanded(e => ({ ...e, [r.id]: !e[r.id] }))} style={{ fontSize: 16, color: '#94a3b8', cursor: 'pointer', padding: '0 4px' }}>
                                                {expanded[r.id] ? '▲' : '▼'}
                                              </div>
                                            </div>
                                          </div>
                                        </div>

                                        {/* 展开内容 */}
                                        {expanded[r.id] && (
                                          <div style={{ borderTop: '1px solid #f1f5f9' }}>
                                            {/* 餐饮照片在最前 */}
                                            <div style={{ padding: '10px 14px', borderBottom: '1px solid #f8fafc' }}>
                                              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>餐饮照片</div>
                                              <PhotoViewer
                                                photos={photos[r.id] || []}
                                                onAdd={files => handleAddPhotos(files, r.id)}
                                                onDelete={handleDeletePhoto}
                                                uploading={uploadingKey === r.id}
                                              />
                                            </div>

                                            {/* 食材/菜品列表 */}
                                            {r.dining_items?.map((item, idx) => (
                                              <div key={idx} style={{
                                                padding: '10px 14px', borderBottom: '1px solid #f8fafc',
                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer'
                                              }} onClick={() => setDetailItem({ item, diningId: r.id })}>
                                                <div style={{ flex: 1 }}>
                                                  <div style={{ fontSize: 14, fontWeight: 500 }}>{item.name_zh}</div>
                                                  {item.memo && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>备注：{item.memo}</div>}
                                                  {(photos[`${r.id}-item-${item.id}`]?.length > 0) && (
                                                    <div style={{ fontSize: 11, color: '#f97316', marginTop: 2 }}>📷 {photos[`${r.id}-item-${item.id}`].length} 张照片</div>
                                                  )}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                  <div style={{ textAlign: 'right', fontSize: 13 }}>
                                                    {r.dining_type === 'home' ? (
                                                      <div style={{ color: '#64748b' }}>{item.consumed_quantity || item.quantity}{item.unit}</div>
                                                    ) : (
                                                      <>
                                                        <div style={{ color: '#64748b' }}>{item.quantity}{item.unit}</div>
                                                        {item.price && (
                                                          <div style={{ fontWeight: 600, color: '#f97316' }}>
                                                            {item.quantity > 1 && <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 4 }}>¥{item.price}×{item.quantity}</span>}
                                                            ¥{(Number(item.price) * Number(item.quantity)).toFixed(0)}
                                                          </div>
                                                        )}
                                                      </>
                                                    )}
                                                    {item.price_contribution > 0 && r.dining_type === 'home' && (
                                                      <div style={{ fontSize: 11, color: '#16a34a' }}>¥{item.price_contribution}</div>
                                                    )}
                                                  </div>
                                                  <span style={{ fontSize: 16, color: '#94a3b8' }}>›</span>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
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
      )}

      {showAdd && <AddDiningModal onClose={() => setShowAdd(false)} onSaved={fetchRecords} />}
      {editingRecord && <EditDiningModal record={editingRecord} onClose={() => setEditingRecord(null)} onSaved={() => { fetchRecords(); setEditingRecord(null) }} />}
      {detailItem && (
        <DishDetailModal
          item={detailItem.item}
          diningId={detailItem.diningId}
          photos={photos}
          onAddPhotos={handleAddPhotos}
          onDeletePhoto={handleDeletePhoto}
          uploading={uploadingKey === `${detailItem.diningId}-item-${detailItem.item.id}`}
          onClose={() => setDetailItem(null)}
          onSaveMemo={handleSaveMemo}
        />
      )}
      {selectingIngredients && (
        <IngredientSelectModal
          diningId={selectingIngredients.diningId}
          dinedAt={selectingIngredients.dinedAt}
          mealTime={selectingIngredients.mealTime}
          existingItems={selectingIngredients.existingItems}
          onClose={() => setSelectingIngredients(null)}
          onSaved={handleIngredientsSaved}
        />
      )}
    </div>
  )
}