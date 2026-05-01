import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { FOOD_CATEGORIES, UNITS, LOCATIONS } from '../lib/categories'

function AddToDiningModal({ item, consumedQty, onClose }) {
  const [dinedAt, setDinedAt] = useState(new Date().toISOString().split('T')[0])
  const [mealTime, setMealTime] = useState(null)
  const [saving, setSaving] = useState(false)

  const MEAL_TIMES = [
    { id: 'breakfast', label: '早餐', icon: '🌅' },
    { id: 'lunch', label: '午餐', icon: '☀️' },
    { id: 'dinner', label: '晚餐', icon: '🌙' },
    { id: 'snack', label: '点心', icon: '🍪' },
  ]

  function calcCost() {
    const price = item.purchase_item?.price
    const totalQty = item.quantity || 1
    if (!price) return 0
    return Math.round((price * consumedQty / totalQty) * 10) / 10
  }

  async function save() {
    if (!mealTime) return alert('请选择餐次')
    setSaving(true)
    const cost = calcCost()

    // 查找当天该餐是否已有自炊履历
    const { data: existing } = await supabase
      .from('dining_history')
      .select('id, home_cost, dining_items(*)')
      .eq('dining_type', 'home')
      .eq('dined_at', dinedAt)
      .eq('meal_time', mealTime)
      .maybeSingle()

    if (existing) {
      // 查找是否已有相同食材
      const existingItem = existing.dining_items?.find(i => i.ingredient_id === item.id)
      if (existingItem) {
        // 更新数量
        const newQty = (existingItem.consumed_quantity || 0) + consumedQty
        const newCost = Math.round((item.purchase_item?.price || 0) * newQty / (item.quantity || 1) * 10) / 10
        await supabase.from('dining_items').update({
          consumed_quantity: newQty,
          price_contribution: newCost
        }).eq('id', existingItem.id)
      } else {
        // 新增食材
        await supabase.from('dining_items').insert({
          dining_id: existing.id,
          name_zh: item.name_zh,
          name_original: item.name_original || null,
          category: item.category || null,
          quantity: item.quantity,
          unit: item.unit || '个',
          consumed_quantity: consumedQty,
          ingredient_id: item.id,
          update_consumed: true,
          price_contribution: cost
        })
      }
      // 更新成本
      const newCost = (existing.home_cost || 0) + cost
      await supabase.from('dining_history').update({ home_cost: Math.round(newCost * 10) / 10 }).eq('id', existing.id)
    } else {
      // 创建新履历
      const { data: dining } = await supabase.from('dining_history').insert({
        dining_type: 'home',
        meal_time: mealTime,
        dined_at: dinedAt,
        home_cost: cost
      }).select().single()

      if (dining) {
        await supabase.from('dining_items').insert({
          dining_id: dining.id,
          name_zh: item.name_zh,
          name_original: item.name_original || null,
          category: item.category || null,
          quantity: item.quantity,
          unit: item.unit || '个',
          consumed_quantity: consumedQty,
          ingredient_id: item.id,
          update_consumed: true,
          price_contribution: cost
        })
      }
    }

    setSaving(false)
    onClose()
  }

  const cost = calcCost()

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430 }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>添加到自炊履历</div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
          {item.name_zh} × {consumedQty}{item.unit}
          {cost > 0 && <span style={{ marginLeft: 6, color: '#16a34a' }}>成本 ¥{cost}</span>}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>就餐日期</div>
          <input style={{ width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 15, border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff' }}
            type="date" value={dinedAt} onChange={e => setDinedAt(e.target.value)} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>餐次 *</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
            {MEAL_TIMES.map(m => (
              <button key={m.id} onClick={() => setMealTime(m.id)} style={{
                padding: '8px 0', borderRadius: 9, fontSize: 12, fontWeight: 600,
                background: mealTime === m.id ? '#16a34a' : '#f1f5f9',
                color: mealTime === m.id ? '#fff' : '#94a3b8',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
              }}>
                <span style={{ fontSize: 18 }}>{m.icon}</span>{m.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px 0', borderRadius: 10, background: '#f1f5f9', color: '#475569', fontSize: 14, fontWeight: 600 }}>
            跳过
          </button>
          <button onClick={save} disabled={!mealTime || saving} style={{
            flex: 2, padding: '11px 0', borderRadius: 10,
            background: mealTime ? '#16a34a' : '#e2e8f0',
            color: mealTime ? '#fff' : '#94a3b8', fontSize: 14, fontWeight: 700
          }}>{saving ? '保存中...' : '添加到履历'}</button>
        </div>
      </div>
    </div>
  )
}
export default function IngredientCard({ item, onDelete, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [consuming, setConsuming] = useState(false)
  const [consumeQty, setConsumeQty] = useState(1)
  const [editingQty, setEditingQty] = useState(false)
  const [form, setForm] = useState({
    name_zh: item.name_zh,
    category: item.category || '',
    quantity: item.quantity || 1,
    unit: item.unit || '个',
    expiry_date: item.expiry_date || '',
    location: item.location || 'fridge',
    memo: item.memo || ''
  })
  const [saving, setSaving] = useState(false)
  const [showAddDining, setShowAddDining] = useState(false)
  const [pendingConsumeData, setPendingConsumeData] = useState(null)
  const today = new Date()
  const expiry = item.expiry_date ? new Date(item.expiry_date) : null
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const expiryDate = expiry ? new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate()) : null
  const daysLeft = expiryDate ? Math.round((expiryDate - todayDate) / 86400000) : null

  const statusColor = daysLeft === null ? '#94a3b8'
    : daysLeft < 0 ? '#ef4444'
    : daysLeft === 0 ? '#ef4444'
    : daysLeft <= 2 ? '#f59e0b'
    : daysLeft <= 7 ? '#f59e0b'
    : '#16a34a'

  const remaining = (item.quantity || 0) - (item.consumed_quantity || 0)

  async function updateQuantity(delta) {
    const newQty = Math.max(1, (item.quantity || 1) + delta)
    await supabase.from('ingredients').update({ quantity: newQty }).eq('id', item.id)
    if (item.purchase_item_id) {
      await supabase.from('purchase_items').update({ quantity: newQty }).eq('id', item.purchase_item_id)
    }
    onUpdate({ ...item, quantity: newQty })
  }

async function consumeItem(all) {
  const qty = all ? remaining : Number(consumeQty)
  if (!qty || qty <= 0) return alert('请输入有效的消耗数量')
  if (qty > remaining) return alert(`最多可消耗 ${remaining}${item.unit}`)
  if (addToDining && !diningMeal) return alert('请选择餐次')

  const newConsumed = (item.consumed_quantity || 0) + qty
  const isFullyConsumed = newConsumed >= (item.quantity || 0)

  await supabase.from('ingredients').update({ consumed_quantity: newConsumed }).eq('id', item.id)
  if (item.purchase_item_id) {
    await supabase.from('purchase_items').update({
      consumed_quantity: newConsumed,
      is_fully_consumed: isFullyConsumed
    }).eq('id', item.purchase_item_id)
  }

  // 保存自炊履历
  if (addToDining && diningMeal) {
    const price = item.purchase_item?.price
    const cost = price ? Math.round((price * qty / (item.quantity || 1)) * 10) / 10 : 0

    const { data: existing } = await supabase
      .from('dining_history')
      .select('id, home_cost, dining_items(*)')
      .eq('dining_type', 'home')
      .eq('dined_at', diningDate)
      .eq('meal_time', diningMeal)
      .maybeSingle()

    if (existing) {
      const existingItem = existing.dining_items?.find(i => i.ingredient_id === item.id)
      if (existingItem) {
        const newQty = (existingItem.consumed_quantity || 0) + qty
        const newCost = price ? Math.round((price * newQty / (item.quantity || 1)) * 10) / 10 : 0
        await supabase.from('dining_items').update({ consumed_quantity: newQty, price_contribution: newCost }).eq('id', existingItem.id)
      } else {
        await supabase.from('dining_items').insert({
          dining_id: existing.id, name_zh: item.name_zh, name_original: item.name_original || null,
          category: item.category || null, quantity: item.quantity, unit: item.unit || '个',
          consumed_quantity: qty, ingredient_id: item.id, update_consumed: true, price_contribution: cost
        })
      }
      await supabase.from('dining_history').update({ home_cost: Math.round(((existing.home_cost || 0) + cost) * 10) / 10 }).eq('id', existing.id)
    } else {
      const { data: dining } = await supabase.from('dining_history').insert({
        dining_type: 'home', meal_time: diningMeal, dined_at: diningDate, home_cost: cost
      }).select().single()
      if (dining) {
        await supabase.from('dining_items').insert({
          dining_id: dining.id, name_zh: item.name_zh, name_original: item.name_original || null,
          category: item.category || null, quantity: item.quantity, unit: item.unit || '个',
          consumed_quantity: qty, ingredient_id: item.id, update_consumed: true, price_contribution: cost
        })
      }
    }
  }

  onUpdate({ ...item, consumed_quantity: newConsumed })
  setConsuming(false)
  setConsumeQty(1)
  setAddToDining(true)
  setDiningMeal(null)
}

  async function saveEdit() {
    setSaving(true)
    const updates = {
      ...form,
      quantity: Number(form.quantity) || 1,
      expiry_date: form.expiry_date || null
    }
    await supabase.from('ingredients').update(updates).eq('id', item.id)
    if (item.purchase_item_id) {
      await supabase.from('purchase_items').update({
        name_zh: form.name_zh,
        category: form.category,
        quantity: Number(form.quantity) || 1,
        unit: form.unit,
        expiry_date: form.expiry_date || null,
        memo: form.memo || null,
        location: form.location,
      }).eq('id', item.purchase_item_id)
    }
    onUpdate({ ...item, ...updates })
    setSaving(false)
    setEditing(false)
  }

  const field = {
    width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 14,
    border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
  }

  if (editing) return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: 14,
      border: '2px solid #16a34a', boxShadow: '0 2px 8px rgba(22,163,74,0.1)'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input style={field} value={form.name_zh}
          onChange={e => setForm(f => ({ ...f, name_zh: e.target.value }))} placeholder="食材名称" />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>数量</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => setForm(f => ({ ...f, quantity: Math.max(1, (Number(f.quantity) || 1) - 1) }))}
                style={{
                  width: 28, height: 28, borderRadius: 7, background: '#f1f5f9',
                  color: '#475569', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>−</button>
              <input style={{ ...field, width: 60, textAlign: 'center', padding: '8px 4px' }}
                type="number" value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
              <button onClick={() => setForm(f => ({ ...f, quantity: (Number(f.quantity) || 1) + 1 }))}
                style={{
                  width: 28, height: 28, borderRadius: 7, background: '#f1f5f9',
                  color: '#475569', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>+</button>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>单位</div>
            <select style={field} value={form.unit}
              onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
              {UNITS.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <select style={field} value={form.category}
          onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
          <option value="">选择分类</option>
          <option value="">选择分类</option>
            {FOOD_CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
        <input style={field} type="date" value={form.expiry_date}
          onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
        <input style={field} value={form.memo}
          onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="备注（可选）" />
        <div style={{ display: 'flex', gap: 8 }}>
          {LOCATIONS.map(([v, l]) => (
            <button key={v} onClick={() => setForm(f => ({ ...f, location: v }))} style={{
              flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 13,
              background: form.location === v ? '#16a34a' : '#f1f5f9',
              color: form.location === v ? '#fff' : '#475569',
              fontWeight: form.location === v ? 600 : 400
            }}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setEditing(false)} style={{
            flex: 1, padding: '9px 0', borderRadius: 10,
            background: '#f1f5f9', color: '#475569', fontSize: 14, fontWeight: 600
          }}>取消</button>
          <button onClick={saveEdit} disabled={saving} style={{
            flex: 2, padding: '9px 0', borderRadius: 10,
            background: '#16a34a', color: '#fff', fontSize: 14, fontWeight: 700
          }}>{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>
    </div>
  )

  const isFullyConsumed = (item.quantity || 0) <= (item.consumed_quantity || 0)
  const [addToDining, setAddToDining] = useState(true)
const [diningDate, setDiningDate] = useState(new Date().toISOString().split('T')[0])
const [diningMeal, setDiningMeal] = useState(null)

      return (
        <div style={{
          background: '#fff', borderRadius: 12, padding: '12px 14px',
          borderLeft: `4px solid ${isFullyConsumed ? '#cbd5e1' : statusColor}`,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          opacity: isFullyConsumed ? 0.6 : 1
        }}>
      {/* 主信息行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }} onClick={() => setEditing(true)}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{item.name_zh}</div>
          {item.name_original && (
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{item.name_original}</div>
          )}
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            {item.category || '未分类'}
            {item.memo && ` · ${item.memo}`}
          </div>
          {item.purchase_item && (
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
              {item.purchase_item.price ? (
                item.purchase_item.is_discount ? (
                  <span>
                    <span style={{ color: '#ef4444', fontWeight: 600 }}>¥{item.purchase_item.price}</span>
                    {item.purchase_item.original_price && (
                      <span style={{ textDecoration: 'line-through', marginLeft: 4 }}>
                        ¥{item.purchase_item.original_price}
                      </span>
                    )}
                    {item.purchase_item.discount_info && (
                      <span style={{ color: '#ef4444', marginLeft: 4 }}>{item.purchase_item.discount_info}</span>
                    )}
                  </span>
                ) : (
                  <span>¥{item.purchase_item.price}</span>
                )
              ) : null}
            </div>
          )}
          {(item.purchase_item?.purchase_history?.store_name || item.created_at) && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, display: 'flex', gap: 8 }}>
              {item.purchase_item?.purchase_history?.store_name && (
                <span>🏪 {item.purchase_item.purchase_history.store_name}</span>
              )}
              {(item.purchase_item?.purchase_history?.purchased_at || item.created_at) && (
                <span>
                  📅 {item.purchase_item?.purchase_history?.purchased_at ||
                    item.created_at?.split('T')[0]}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 过期信息 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          {isFullyConsumed ? (
            <span style={{
              fontSize: 12, fontWeight: 600, color: '#94a3b8',
              background: '#f1f5f9', padding: '2px 8px', borderRadius: 99
            }}>已食用</span>
          ) : item.expiry_date ? (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>到期 {item.expiry_date}</div>
              <span style={{
                fontSize: 12, fontWeight: 600, color: statusColor,
                background: statusColor + '18', padding: '2px 6px', borderRadius: 99,
                marginTop: 2, display: 'inline-block'
              }}>
                {daysLeft === 0 ? '今天过期'
                  : daysLeft < 0 ? `已过期 ${Math.abs(daysLeft)} 天`
                  : `还剩 ${daysLeft} 天`}
              </span>
            </div>
          ) : null}
          <button onClick={() => onDelete(item.id)} style={{
            fontSize: 18, background: 'none', color: '#cbd5e1', lineHeight: 1, marginTop: 4
          }}>×</button>
        </div>
      </div>

      {/* 剩余数量 + 消耗按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <div style={{ fontSize: 14, color: '#475569' }}>
          <span style={{ fontWeight: 600 }}>剩余 {remaining}{item.unit}</span>
          {(item.consumed_quantity || 0) > 0 && (
            <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>
              (已用 {item.consumed_quantity}{item.unit})
            </span>
          )}
        </div>
        <button onClick={() => { setConsuming(!consuming); setConsumeQty(1); setEditingQty(false) }}
          style={{
            padding: '5px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: consuming ? '#f1f5f9' : '#fef3c7',
            color: consuming ? '#475569' : '#92400e'
          }}>
          {consuming ? '取消' : '食用'}
        </button>
      </div>

      {/* 消耗面板 */}
      {consuming && (
        <div style={{
          marginTop: 10, padding: '12px', borderRadius: 10,
          background: '#fafafa', border: '1px solid #f1f5f9'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 10 }}>
            <button onClick={() => { setConsumeQty(q => Math.max(1, Number(q) - 1)); setEditingQty(false) }}
              style={{
                width: 36, height: 36, borderRadius: 10, background: '#f1f5f9',
                color: '#475569', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 600
              }}>−</button>

            {editingQty ? (
              <input
                type="number"
                value={consumeQty}
                onChange={e => setConsumeQty(Math.min(remaining, Math.max(1, Number(e.target.value))))}
                onBlur={() => setEditingQty(false)}
                autoFocus
                style={{
                  width: 70, textAlign: 'center', fontSize: 18, fontWeight: 700,
                  padding: '4px 8px', borderRadius: 8, border: '1.5px solid #16a34a', outline: 'none'
                }}
              />
            ) : (
              <div onClick={() => setEditingQty(true)} style={{
                width: 70, textAlign: 'center', fontSize: 18, fontWeight: 700,
                color: '#1e293b', cursor: 'text',
                padding: '4px 8px', borderRadius: 8, border: '1.5px solid #e2e8f0',
                background: '#fff'
              }}>
                {consumeQty}
              </div>
            )}

            <button onClick={() => { setConsumeQty(q => Math.min(remaining, Number(q) + 1)); setEditingQty(false) }}
              style={{
                width: 36, height: 36, borderRadius: 10, background: '#f1f5f9',
                color: '#475569', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 600
              }}>+</button>
          </div>

          <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginBottom: 10 }}>
            {item.unit}　点击数字可手动输入　最多 {remaining}{item.unit}
          </div>
          {/* 保存履历选项 */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#475569', marginBottom: 8 }}>
              <input type="checkbox" checked={addToDining} onChange={e => setAddToDining(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: '#16a34a' }} />
              同时添加到自炊履历
            </label>
            {addToDining && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', background: '#f0fdf4', borderRadius: 8 }}>
                <input type="date" value={diningDate} onChange={e => setDiningDate(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 7, fontSize: 13, border: '1.5px solid #e2e8f0', outline: 'none', boxSizing: 'border-box' }} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5 }}>
                  {[['breakfast','🌅','早'],['lunch','☀️','午'],['dinner','🌙','晚'],['snack','🍪','点']].map(([id, icon, label]) => (
                    <button key={id} onClick={() => setDiningMeal(diningMeal === id ? null : id)} style={{
                      padding: '5px 0', borderRadius: 7, fontSize: 11, fontWeight: 600,
                      background: diningMeal === id ? '#16a34a' : '#fff',
                      color: diningMeal === id ? '#fff' : '#94a3b8',
                      border: `1px solid ${diningMeal === id ? '#16a34a' : '#e2e8f0'}`,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1
                    }}>
                      <span style={{ fontSize: 14 }}>{icon}</span>{label}
                    </button>
                  ))}
                </div>
                {addToDining && !diningMeal && (
                  <div style={{ fontSize: 11, color: '#f59e0b' }}>请选择餐次才能保存履历</div>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => consumeItem(false)} style={{
              flex: 2, padding: '10px 0', borderRadius: 10,
              background: '#f59e0b', color: '#fff', fontSize: 14, fontWeight: 700
            }}>已食用 {consumeQty}{item.unit}</button>
            <button onClick={() => consumeItem(true)} style={{
              flex: 1, padding: '10px 0', borderRadius: 10,
              background: '#ef4444', color: '#fff', fontSize: 14, fontWeight: 600
            }}>全部</button>
          </div>
        </div>
      )}
      {showAddDining && pendingConsumeData && (
        <AddToDiningModal
          item={item}
          consumedQty={pendingConsumeData.qty}
          onClose={() => { setShowAddDining(false); setPendingConsumeData(null) }}
        />
      )}
    </div>
  )
}