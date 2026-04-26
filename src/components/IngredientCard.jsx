import { useState } from 'react'
import { supabase } from '../lib/supabase'

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
    const newConsumed = (item.consumed_quantity || 0) + qty
    const isFullyConsumed = newConsumed >= (item.quantity || 0)

    await supabase.from('ingredients').update({ consumed_quantity: newConsumed }).eq('id', item.id)

    if (item.purchase_item_id) {
      await supabase.from('purchase_items').update({
        consumed_quantity: newConsumed,
        is_fully_consumed: isFullyConsumed
      }).eq('id', item.purchase_item_id)
    } else if (isFullyConsumed) {
      await supabase.from('purchase_items')
        .update({ is_fully_consumed: true })
        .eq('name_zh', item.name_zh)
        .eq('add_to_fridge', true)
    }

    onUpdate({ ...item, consumed_quantity: newConsumed })
    setConsuming(false)
    setConsumeQty(1)
    setEditingQty(false)
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
              {['个','包','瓶','袋','克','毫升','升','根','片','块'].map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <select style={field} value={form.category}
          onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
          <option value="">选择分类</option>
          {['蔬菜','水果','肉类','海鲜','乳制品','饮料','调味料','冷冻食品','其他'].map(c =>
            <option key={c}>{c}</option>)}
        </select>
        <input style={field} type="date" value={form.expiry_date}
          onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
        <input style={field} value={form.memo}
          onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="备注（可选）" />
        <div style={{ display: 'flex', gap: 8 }}>
          {[['fridge','冰箱'],['freezer','冷冻'],['pantry','常温']].map(([v, l]) => (
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
          {item.expiry_date && (
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
          )}
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
          {consuming ? '取消' : '消耗'}
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

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => consumeItem(false)} style={{
              flex: 2, padding: '10px 0', borderRadius: 10,
              background: '#f59e0b', color: '#fff', fontSize: 14, fontWeight: 700
            }}>消耗 {consumeQty}{item.unit}</button>
            <button onClick={() => consumeItem(true)} style={{
              flex: 1, padding: '10px 0', borderRadius: 10,
              background: '#ef4444', color: '#fff', fontSize: 14, fontWeight: 600
            }}>全部</button>
          </div>
        </div>
      )}
    </div>
  )
}