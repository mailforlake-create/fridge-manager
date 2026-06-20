import { useState } from 'react'
import { supabase } from '../lib/supabase'
//import { DAILY_CATEGORIES, DAILY_UNITS, DAILY_LOCATIONS } from '../lib/categories'
import { useSettings } from '../context/SettingsContext'
import ConfirmModal from './ConfirmModal'

export default function DailyItemCard({ item, onDelete, onUpdate }) {
  const { settings } = useSettings()
const DAILY_CATS = settings.daily_categories
const DAILY_UNITS = settings.daily_units
const DAILY_LOCS = settings.daily_locations
  const itemConsumeStep = Math.min(10, Math.max(0.01, Number(settings.item_consume_step) || 0.1))
  const [syncPurchase, setSyncPurchase] = useState(true)
  const [editing, setEditing] = useState(false)
  const [consuming, setConsuming] = useState(false)
  const [consumeQty, setConsumeQty] = useState(1)
  const [editingQty, setEditingQty] = useState(false)
  const [showConsumed, setShowConsumed] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [form, setForm] = useState({
    name_zh: item.name_zh,
    name_original: item.name_original || '',
    category: item.category || '',
    quantity: item.quantity || 1,
    unit: item.unit || '个',
    location: item.location || 'home',
    memo: item.memo || ''
  })
  const [saving, setSaving] = useState(false)

  const remaining = (item.quantity || 0) - (item.consumed_quantity || 0)

  async function consumeItem(all) {
    const qty = all ? remaining : Number(consumeQty)
    if (!qty || qty <= 0) return alert('请输入有效的使用数量')
    if (qty > remaining) return alert(`最多可使用 ${remaining}${item.unit}`)
    const newConsumed = (item.consumed_quantity || 0) + qty
    await supabase.from('daily_items').update({ consumed_quantity: newConsumed }).eq('id', item.id)
    onUpdate({ ...item, consumed_quantity: newConsumed })
    setConsuming(false)
    setConsumeQty(itemConsumeStep)
    setEditingQty(false)
  }

async function saveEdit() {
  setSaving(true)
  const updates = {
    ...form,
    quantity: Number(form.quantity) || 1,
  }
  await supabase.from('daily_items').update(updates).eq('id', item.id)

  // 同步到购物履历
  if (syncPurchase && item.purchase_item_id) {
    await supabase.from('purchase_items').update({
      name_zh: form.name_zh,
      name_original: form.name_original || null,
      category: form.category || null,
      quantity: Number(form.quantity) || 1,
      unit: form.unit,
      memo: form.memo || null,
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
      border: '2px solid #3b82f6', boxShadow: '0 2px 8px rgba(59,130,246,0.1)'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input style={field} value={form.name_zh}
          onChange={e => setForm(f => ({ ...f, name_zh: e.target.value }))} placeholder="物品名称" />
        <input style={field} value={form.name_original}
          onChange={e => setForm(f => ({ ...f, name_original: e.target.value }))} placeholder="原文名称（可选）" />
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>数量</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => setForm(f => ({ ...f, quantity: Math.max(1, (Number(f.quantity) || 1) - 1) }))}
                style={{ width: 28, height: 28, borderRadius: 7, background: '#f1f5f9', color: '#475569', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
              <input style={{ ...field, width: 60, textAlign: 'center', padding: '8px 4px' }}
                type="number" value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
              <button onClick={() => setForm(f => ({ ...f, quantity: (Number(f.quantity) || 1) + 1 }))}
                style={{ width: 28, height: 28, borderRadius: 7, background: '#f1f5f9', color: '#475569', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>单位</div>
            <select style={field} value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
              {DAILY_UNITS.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <select style={field} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
          <option value="">选择分类</option>
          {DAILY_CATS.map(c => <option key={c}>{c}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 8 }}>
          {DAILY_LOCS.map(([v, l]) => (
            <button key={v} onClick={() => setForm(f => ({ ...f, location: v }))} style={{
              flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 13,
              background: form.location === v ? '#3b82f6' : '#f1f5f9',
              color: form.location === v ? '#fff' : '#475569',
              fontWeight: form.location === v ? 600 : 400
            }}>{l}</button>
          ))}
        </div>
        <input style={field} value={form.memo}
          onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="备注（可选）" />
        {item.purchase_item_id && (
          <div style={{ background: '#f8fafc', borderRadius: 9, padding: '9px 11px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#475569' }}>
              <input type="checkbox" checked={syncPurchase} onChange={e => setSyncPurchase(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: '#3b82f6' }} />
              同步更新购物履历
            </label>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setEditing(false)} style={{
            flex: 1, padding: '9px 0', borderRadius: 10,
            background: '#f1f5f9', color: '#475569', fontSize: 14, fontWeight: 600
          }}>取消</button>
          <button onClick={saveEdit} disabled={saving} style={{
            flex: 2, padding: '9px 0', borderRadius: 10,
            background: '#3b82f6', color: '#fff', fontSize: 14, fontWeight: 700
          }}>{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>
    </div>
  )

const isFullyConsumed = (item.quantity || 0) <= (item.consumed_quantity || 0)

    return (
      <div style={{
        background: '#fff', borderRadius: 12, padding: '12px 14px',
        borderLeft: `4px solid ${isFullyConsumed ? '#cbd5e1' : '#3b82f6'}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        opacity: isFullyConsumed ? 0.6 : 1
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
          {item.purchase_item?.purchase_history?.store_name && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, display: 'flex', gap: 8 }}>
              <span>🏪 {item.purchase_item.purchase_history.store_name}</span>
              {item.purchase_item.purchase_history.purchased_at && (
                <span>📅 {item.purchase_item.purchase_history.purchased_at}</span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {isFullyConsumed && (
            <span style={{
              fontSize: 12, fontWeight: 600, color: '#94a3b8',
              background: '#f1f5f9', padding: '2px 8px', borderRadius: 99
            }}>已使用</span>
          )}
          <button onClick={() => setDeleteConfirm(item)} style={{
            fontSize: 18, background: 'none', color: '#cbd5e1', lineHeight: 1
          }}>×</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <div style={{ fontSize: 14, color: '#475569' }}>
          <span style={{ fontWeight: 600 }}>剩余 {remaining}{item.unit}</span>
          {(item.consumed_quantity || 0) > 0 && (
            <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>
              (已用 {item.consumed_quantity}{item.unit})
            </span>
          )}
        </div>
        {!isFullyConsumed && (
          <button onClick={() => { setConsuming(!consuming); setConsumeQty(itemConsumeStep); setEditingQty(false) }}
            style={{
              padding: '5px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: consuming ? '#f1f5f9' : '#dbeafe',
              color: consuming ? '#475569' : '#1d4ed8'
            }}>
            {consuming ? '取消' : '使用'}
          </button>
        )}
      </div>

      {!isFullyConsumed && consuming && (
        <div style={{
          marginTop: 10, padding: '12px', borderRadius: 10,
          background: '#fafafa', border: '1px solid #f1f5f9'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 10 }}>
            <button onClick={() => { setConsumeQty(q => Math.max(itemConsumeStep, parseFloat((Number(q) - itemConsumeStep).toFixed(2)))); setEditingQty(false) }}
              style={{ width: 36, height: 36, borderRadius: 10, background: '#f1f5f9', color: '#475569', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>−</button>
            {editingQty ? (
              <input type="number" step={itemConsumeStep} value={consumeQty}
                onChange={e => setConsumeQty(Math.min(remaining, Math.max(itemConsumeStep, Number(e.target.value))))}
                onBlur={() => setEditingQty(false)} autoFocus
                style={{ width: 70, textAlign: 'center', fontSize: 18, fontWeight: 700, padding: '4px 8px', borderRadius: 8, border: '1.5px solid #3b82f6', outline: 'none' }} />
            ) : (
              <div onClick={() => setEditingQty(true)} style={{
                width: 70, textAlign: 'center', fontSize: 18, fontWeight: 700, color: '#1e293b',
                cursor: 'text', padding: '4px 8px', borderRadius: 8,
                border: '1.5px solid #e2e8f0', background: '#fff'
              }}>{consumeQty}</div>
            )}
            <button onClick={() => { setConsumeQty(q => Math.min(remaining, parseFloat((Number(q) + itemConsumeStep).toFixed(2)))); setEditingQty(false) }}
              style={{ width: 36, height: 36, borderRadius: 10, background: '#f1f5f9', color: '#475569', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>+</button>
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginBottom: 10 }}>
            {item.unit}　点击数字可手动输入　最多 {remaining}{item.unit}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => consumeItem(false)} style={{
              flex: 2, padding: '10px 0', borderRadius: 10,
              background: '#3b82f6', color: '#fff', fontSize: 14, fontWeight: 700
            }}>已使用 {consumeQty}{item.unit}</button>
            <button onClick={() => consumeItem(true)} style={{
              flex: 1, padding: '10px 0', borderRadius: 10,
              background: '#ef4444', color: '#fff', fontSize: 14, fontWeight: 600
            }}>全部</button>
          </div>
        </div>
      )}
      {deleteConfirm && (
        <ConfirmModal
          title="删除物品"
          message={`确认删除「${deleteConfirm.name_zh}」？`}
          confirmText="确认删除"
          onConfirm={() => { onDelete(deleteConfirm.id); setDeleteConfirm(null) }}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  )
}
