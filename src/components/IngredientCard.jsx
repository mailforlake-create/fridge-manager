import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function IngredientCard({ item, onDelete, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [consuming, setConsuming] = useState(false)
  const [consumeQty, setConsumeQty] = useState('')
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
  const daysLeft = expiry ? Math.ceil((expiry - today) / 86400000) : null
  const statusColor = !daysLeft ? '#94a3b8'
    : daysLeft <= 2 ? '#ef4444'
    : daysLeft <= 7 ? '#f59e0b'
    : '#16a34a'

  const remaining = (item.quantity || 0) - (item.consumed_quantity || 0)

  async function updateQuantity(delta) {
    const newQty = Math.max(0, (item.quantity || 1) + delta)
    if (newQty === 0) { onDelete(item.id); return }
    await supabase.from('ingredients').update({ quantity: newQty }).eq('id', item.id)
    onUpdate({ ...item, quantity: newQty })
  }

async function consumeItem(all) {
  const qty = all ? remaining : Number(consumeQty)
  if (!qty || qty <= 0) return alert('请输入有效的消耗数量')
  if (qty > remaining) return alert(`最多可消耗 ${remaining}${item.unit}`)
  const newConsumed = (item.consumed_quantity || 0) + qty
  const isFullyConsumed = newConsumed >= (item.quantity || 0)

  await supabase.from('ingredients').update({ consumed_quantity: newConsumed }).eq('id', item.id)

  // 优先用 purchase_item_id 精准更新，避免更新到错误的记录
  if (item.purchase_item_id) {
    await supabase.from('purchase_items').update({
      consumed_quantity: newConsumed,
      is_fully_consumed: isFullyConsumed
    }).eq('id', item.purchase_item_id)
  } else if (isFullyConsumed) {
    // 没有关联时用 name_zh 匹配最新一条
    await supabase.from('purchase_items')
      .update({ is_fully_consumed: true })
      .eq('name_zh', item.name_zh)
      .eq('add_to_fridge', true)
      .order('created_at', { ascending: false })
      .limit(1)
  }

  onUpdate({ ...item, consumed_quantity: newConsumed })
  setConsuming(false)
  setConsumeQty('')
}

async function saveEdit() {
  setSaving(true)
  const updates = {
    ...form,
    quantity: Number(form.quantity) || 1,
    expiry_date: form.expiry_date || null
  }
  await supabase.from('ingredients').update(updates).eq('id', item.id)

  // 同步更新 purchase_items
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
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...field, flex: 1 }} type="number" value={form.quantity}
            onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} placeholder="数量" />
          <select style={{ ...field, flex: 1 }} value={form.unit}
            onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
            {['个','包','瓶','袋','克','毫升','升','根','片','块'].map(u => <option key={u}>{u}</option>)}
          </select>
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

  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: '12px 14px',
      borderLeft: `4px solid ${statusColor}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
    }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {item.expiry_date && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                到期 {item.expiry_date}
              </div>
              <span style={{
                fontSize: 12, fontWeight: 600, color: statusColor,
                background: statusColor + '18', padding: '2px 6px', borderRadius: 99,
                marginTop: 2, display: 'inline-block'
              }}>
                {daysLeft <= 0 ? '已过期' : `还剩 ${daysLeft} 天`}
              </span>
            </div>
          )}
          <button onClick={() => onDelete(item.id)} style={{
            fontSize: 18, background: 'none', color: '#cbd5e1', lineHeight: 1
          }}>×</button>
        </div>
      </div>

      {/* 数量增减 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <button onClick={() => updateQuantity(-1)} style={{
          width: 28, height: 28, borderRadius: 8, background: '#f1f5f9',
          color: '#475569', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>−</button>
        <span style={{ fontSize: 15, fontWeight: 600, minWidth: 60, textAlign: 'center' }}>
          {remaining}{item.unit}
          {(item.consumed_quantity || 0) > 0 && (
            <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>
              (已用{item.consumed_quantity})
            </span>
          )}
        </span>
        <button onClick={() => updateQuantity(1)} style={{
          width: 28, height: 28, borderRadius: 8, background: '#f1f5f9',
          color: '#475569', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>+</button>
        <button onClick={() => { setConsuming(!consuming); setConsumeQty('') }} style={{
          marginLeft: 'auto', padding: '4px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600,
          background: consuming ? '#f1f5f9' : '#fef3c7', color: consuming ? '#475569' : '#92400e'
        }}>{consuming ? '取消' : '消耗'}</button>
      </div>

      {/* 消耗面板 */}
      {consuming && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="number" value={consumeQty} onChange={e => setConsumeQty(e.target.value)}
            placeholder={`数量（最多${remaining}）`}
            style={{
              flex: 1, padding: '7px 10px', borderRadius: 8, fontSize: 13,
              border: '1.5px solid #e2e8f0', outline: 'none'
            }} />
          <button onClick={() => consumeItem(false)} style={{
            padding: '7px 12px', borderRadius: 8, background: '#f59e0b',
            color: '#fff', fontSize: 13, fontWeight: 600
          }}>消耗</button>
          <button onClick={() => consumeItem(true)} style={{
            padding: '7px 12px', borderRadius: 8, background: '#ef4444',
            color: '#fff', fontSize: 13, fontWeight: 600
          }}>全部</button>
        </div>
      )}
    </div>
  )
}