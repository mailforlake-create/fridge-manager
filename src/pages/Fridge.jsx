import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import IngredientCard from '../components/IngredientCard'
import DailyItems from './DailyItems'
import { recognizePhoto, callAI, fileToBase64, calcExpiry } from '../lib/aiRecognition'
import { FOOD_CATEGORIES } from '../lib/categories'

const UNITS = ['个','包','瓶','袋','克','毫升','升','根','片','块']
const EMPTY_FORM = {
  name_zh: '', name_original: '', category: '',
  quantity: 1, unit: '个', expiry_date: '',
  mfg_date: '', shelf_days: '', location: 'fridge', memo: ''
}

function parseIngredients(text) {
  try {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (match) return JSON.parse(match[0])
  } catch (e) { console.error('解析失败：', e) }
  return []
}

function calcExpiryLocal(mfgDate, shelfDays) {
  if (!mfgDate || !shelfDays) return ''
  const d = new Date(mfgDate)
  d.setDate(d.getDate() + Number(shelfDays))
  return d.toISOString().split('T')[0]
}

// 手动添加弹窗
function ManualAddModal({ onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [collapsedYears, setCollapsedYears] = useState({})
  const [collapsedMonths, setCollapsedMonths] = useState({})
  const set = (k, v) => setForm(f => {
    const next = { ...f, [k]: v }
    if (k === 'mfg_date' || k === 'shelf_days') {
      next.expiry_date = calcExpiryLocal(
        k === 'mfg_date' ? v : f.mfg_date,
        k === 'shelf_days' ? v : f.shelf_days
      )
    }
    return next
  })

  async function save() {
    if (!form.name_zh.trim()) return alert('请输入食材名称')
    setSaving(true)
    await supabase.from('ingredients').insert({
      name_zh: form.name_zh,
      name_original: form.name_original || null,
      category: form.category || null,
      quantity: Number(form.quantity) || 1,
      unit: form.unit,
      expiry_date: form.expiry_date || null,
      location: form.location,
      memo: form.memo || null
    })
    setSaving(false)
    onSaved()
    onClose()
  }

  const field = {
    width: '100%', padding: '9px 12px', borderRadius: 9, fontSize: 14,
    border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
  }
  const small = { fontSize: 12, color: '#94a3b8', marginBottom: 3 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>手动添加食材</div>
          <button onClick={onClose} style={{ background: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><div style={small}>食材名称（中文）*</div>
            <input style={field} value={form.name_zh} onChange={e => set('name_zh', e.target.value)} placeholder="例：牛奶" /></div>
          <div><div style={small}>原文名称</div>
            <input style={field} value={form.name_original} onChange={e => set('name_original', e.target.value)} placeholder="例：牛乳" /></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}><div style={small}>数量</div>
              <input style={field} type="number" value={form.quantity} onChange={e => set('quantity', e.target.value)} /></div>
            <div style={{ flex: 1 }}><div style={small}>单位</div>
              <select style={field} value={form.unit} onChange={e => set('unit', e.target.value)}>
                {UNITS.map(u => <option key={u}>{u}</option>)}</select></div>
          </div>
          <div><div style={small}>分类</div>
            <select style={field} value={form.category} onChange={e => set('category', e.target.value)}>
              <option value="">选择分类</option>
              {FOOD_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select></div>
          <div>
            <div style={small}>保质期</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>生产日期</div>
                <input style={field} type="date" value={form.mfg_date} onChange={e => set('mfg_date', e.target.value)} /></div>
              <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>保质期(天)</div>
                <input style={field} type="number" value={form.shelf_days} onChange={e => set('shelf_days', e.target.value)} placeholder="如：180" /></div>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>过期日期</div>
            <input style={field} type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} />
          </div>
          <div>
            <div style={small}>存放位置</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['fridge','冰箱'],['freezer','冷冻'],['pantry','常温']].map(([v, l]) => (
                <button key={v} onClick={() => set('location', v)} style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13,
                  background: form.location === v ? '#16a34a' : '#f1f5f9',
                  color: form.location === v ? '#fff' : '#475569', fontWeight: form.location === v ? 600 : 400
                }}>{l}</button>
              ))}
            </div>
          </div>
          <div><div style={small}>备注</div>
            <input style={field} value={form.memo} onChange={e => set('memo', e.target.value)} placeholder="可选" /></div>
          <button onClick={save} disabled={saving} style={{
            padding: '13px 0', borderRadius: 12, background: '#16a34a',
            color: '#fff', fontSize: 15, fontWeight: 700
          }}>{saving ? '保存中...' : '保存食材'}</button>
        </div>
      </div>
    </div>
  )
}

// 拍照识别弹窗
function PhotoAddModal({ onClose, onSaved }) {
  const [aiItems, setAiItems] = useState([])
  const [selected, setSelected] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const smallField = {
    width: '100%', padding: '6px 8px', borderRadius: 7, fontSize: 13,
    border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
  }

  const setItemField = useCallback((i, k, v) => {
    setAiItems(items => { const n = [...items]; n[i] = { ...n[i], [k]: v }; return n })
  }, [])

  async function handlePhoto(file) {
    setLoading(true)
    try {
      const items = await recognizePhoto(file)
      setAiItems(items.map(i => ({ ...i, mfg_date: '', shelf_days: '' })))
      const sel = {}
      items.forEach((_, i) => { sel[i] = true })
      setSelected(sel)
    } catch (e) { alert('识别失败：' + e.message) }
    setLoading(false)
  }

  async function save() {
    const toSave = aiItems.filter((_, i) => selected[i])
    if (!toSave.length) return alert('请至少选择一项')
    setSaving(true)
    for (const item of toSave) {
      await supabase.from('ingredients').insert({
        name_zh: item.name_zh,
        name_original: item.name_original || null,
        category: item.category || null,
        quantity: Number(item.quantity) || 1,
        unit: item.unit || '个',
        expiry_date: item.expiry_date || null,
        location: 'fridge'
      })
    }
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>拍照识别食材</div>
          <button onClick={onClose} style={{ background: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#16a34a' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>✨</div>AI 识别中...
          </div>
        )}

        {!loading && aiItems.length === 0 && (
          <div>
            <input type="file" accept="image/*" capture="environment"
              style={{ display: 'none' }} id="modal-photo-input"
              onChange={e => { const f = e.target.files[0]; e.target.value = ''; handlePhoto(f) }} />
            <button onClick={() => document.getElementById('modal-photo-input').click()} style={{
              width: '100%', padding: '40px 0', borderRadius: 14,
              border: '2px dashed #cbd5e1', background: '#f8fafc',
              color: '#64748b', fontSize: 15, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8
            }}>
              <span style={{ fontSize: 40 }}>📷</span>
              <span style={{ fontWeight: 600 }}>拍摄或选择食材照片</span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>支持单个或多个食材</span>
            </button>
          </div>
        )}

        {!loading && aiItems.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>识别到 {aiItems.length} 种食材：</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { const s = {}; aiItems.forEach((_, i) => { s[i] = true }); setSelected(s) }}
                  style={{ padding: '4px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600, background: '#f1f5f9', color: '#475569' }}>全选</button>
                <button onClick={() => setSelected({})}
                  style={{ padding: '4px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600, background: '#f1f5f9', color: '#475569' }}>全不选</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {aiItems.map((item, i) => (
                <div key={i} style={{
                  background: selected[i] ? '#f0fdf4' : '#f8fafc',
                  border: `1.5px solid ${selected[i] ? '#16a34a' : '#e2e8f0'}`,
                  borderRadius: 12, padding: '10px 12px'
                }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div onClick={() => setSelected(s => ({ ...s, [i]: !s[i] }))} style={{
                      width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 2, cursor: 'pointer',
                      border: `2px solid ${selected[i] ? '#16a34a' : '#cbd5e1'}`,
                      background: selected[i] ? '#16a34a' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      {selected[i] && <span style={{ color: '#fff', fontSize: 13 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input style={{ ...smallField, flex: 2 }} value={item.name_zh}
                          onChange={e => setItemField(i, 'name_zh', e.target.value)} />
                        <input style={{ ...smallField, flex: 1, textAlign: 'center' }} type="number" value={item.quantity}
                          onChange={e => setItemField(i, 'quantity', e.target.value)} />
                        <select style={{ ...smallField, flex: 1 }} value={item.unit}
                          onChange={e => setItemField(i, 'unit', e.target.value)}>
                          {UNITS.map(u => <option key={u}>{u}</option>)}
                        </select>
                      </div>
                      <select style={smallField} value={item.category || ''}
                        onChange={e => setItemField(i, 'category', e.target.value)}>
                        <option value="">分类</option>
                        {FOOD_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                      <input style={smallField} type="date" value={item.expiry_date || ''}
                        onChange={e => setItemField(i, 'expiry_date', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setAiItems([]); setSelected({}) }} style={{
                flex: 1, padding: '12px 0', borderRadius: 12, background: '#f1f5f9', color: '#475569', fontSize: 14, fontWeight: 600
              }}>重新识别</button>
              <button onClick={save} disabled={saving} style={{
                flex: 2, padding: '12px 0', borderRadius: 12, background: '#16a34a', color: '#fff', fontSize: 15, fontWeight: 700
              }}>{saving ? '保存中...' : '保存选中项'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// 条形码弹窗
function BarcodeModal({ onClose, onSaved }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const field = {
    width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 15,
    border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
  }

  async function lookup() {
    if (!code.trim()) return
    setLoading(true)
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`)
      const data = await res.json()
      if (data.status === 1) {
        const p = data.product
        const original = p.product_name_ja || p.product_name_en || p.product_name || ''
        const zh = await callAI([{ role: 'user', content: `将以下食品名称翻译成中文，只输出中文名称：${original}` }])
        setForm({ name_zh: zh.trim(), name_original: original, category: '其他', quantity: 1, unit: '个', expiry_date: '', memo: '' })
      } else {
        alert('未找到该条形码，请手动输入')
      }
    } catch { alert('查询失败') }
    setLoading(false)
  }

  async function save() {
    if (!form?.name_zh.trim()) return alert('请输入食材名称')
    setSaving(true)
    await supabase.from('ingredients').insert({
      name_zh: form.name_zh,
      name_original: form.name_original || null,
      category: form.category || null,
      quantity: Number(form.quantity) || 1,
      unit: form.unit,
      expiry_date: form.expiry_date || null,
      memo: form.memo || null,
      location: 'fridge'
    })
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>条形码查询</div>
          <button onClick={onClose} style={{ background: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        {!form ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input value={code} onChange={e => setCode(e.target.value)}
              placeholder="输入条形码数字"
              onKeyDown={e => e.key === 'Enter' && lookup()}
              style={field} />
            <button onClick={lookup} disabled={!code || loading} style={{
              padding: '12px 0', borderRadius: 12, background: '#16a34a',
              color: '#fff', fontSize: 15, fontWeight: 700, opacity: !code || loading ? 0.6 : 1
            }}>{loading ? '查询中...' : '查询商品'}</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input style={field} value={form.name_zh} onChange={e => setForm(f => ({ ...f, name_zh: e.target.value }))} placeholder="食材名称" />
            <input style={field} value={form.name_original} onChange={e => setForm(f => ({ ...f, name_original: e.target.value }))} placeholder="原文名称" />
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...field, flex: 1 }} type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
              <select style={{ ...field, flex: 1 }} value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
                {UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <input style={field} type="date" value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
            <button onClick={save} disabled={saving} style={{
              padding: '12px 0', borderRadius: 12, background: '#16a34a', color: '#fff', fontSize: 15, fontWeight: 700
            }}>{saving ? '保存中...' : '保存食材'}</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Fridge() {
  const [tab, setTab] = useState('food')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [showPhoto, setShowPhoto] = useState(false)
  const [showBarcode, setShowBarcode] = useState(false)
  const [collapsedYears, setCollapsedYears] = useState({})
  const [collapsedMonths, setCollapsedMonths] = useState({})
  const [showConsumed, setShowConsumed] = useState(false)

  useEffect(() => { if (tab === 'food') fetchItems() }, [tab])

  async function fetchItems() {
    setLoading(true)
    const { data } = await supabase
      .from('ingredients')
      .select(`*, purchase_item:purchase_item_id (
        price, original_price, is_discount, discount_info, history_id, created_at,
        purchase_history:history_id ( store_name, purchased_at )
      )`)
      .order('expiry_date', { ascending: true, nullsFirst: false })
    //setItems((data || []).filter(i => (i.quantity || 0) > (i.consumed_quantity || 0)))
    setItems(data || [])
    setLoading(false)
  }

  async function deleteItem(id) {
    await supabase.from('ingredients').delete().eq('id', id)
    setItems(items.filter(i => i.id !== id))
  }

  function updateItem(updated) {
    const remaining = (updated.quantity || 0) - (updated.consumed_quantity || 0)
    if (remaining <= 0) setItems(items.filter(i => i.id !== updated.id))
    else setItems(items.map(i => i.id === updated.id ? updated : i))
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
    <div style={{ padding: '16px 16px 0' }}>
      {/* Tab 切换 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16, background: '#f1f5f9', borderRadius: 12, padding: 4 }}>
        {[['food','🥦 食品'], ['daily','🧴 日用品']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '9px 0', borderRadius: 9, fontSize: 13, fontWeight: 600,
            background: tab === id ? '#fff' : 'transparent',
            color: tab === id ? (id === 'food' ? '#16a34a' : '#3b82f6') : '#94a3b8',
            boxShadow: tab === id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
          }}>{label}</button>
        ))}
      </div>

      {tab === 'daily' && <DailyItems />}

      {tab === 'food' && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>🥦 食品</h1>
            <span style={{ fontSize: 13, color: '#94a3b8' }}>
              {filter === 'all' && !search
                ? `共 ${items.filter(i => (i.quantity||0) > (i.consumed_quantity||0)).length} 件`
                : `${filtered.length} / ${items.filter(i => (i.quantity||0) > (i.consumed_quantity||0)).length} 件`}
            </span>
          </div>

          {/* 添加入口 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
            {[
              ['✏️', '手动添加', () => setShowManual(true)],
              ['📷', '拍照识别', () => setShowPhoto(true)],
              ['📦', '条形码', () => setShowBarcode(true)],
            ].map(([icon, label, onClick]) => (
              <button key={label} onClick={onClick} style={{
                padding: '10px 0', borderRadius: 10, background: '#f0fdf4',
                color: '#16a34a', fontSize: 13, fontWeight: 600,
                border: '1.5px dashed #86efac',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3
              }}>
                <span style={{ fontSize: 20 }}>{icon}</span>{label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#475569', userSelect: 'none' }}>
              <input type="checkbox" checked={showConsumed}
                onChange={e => setShowConsumed(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: '#16a34a' }} />
              显示已消耗物品
            </label>
            {showConsumed && (
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                含 {items.filter(i => (i.quantity||0) <= (i.consumed_quantity||0)).length} 件已消耗
              </span>
            )}
          </div>
          {/* 搜索框 */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: '#94a3b8', pointerEvents: 'none' }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索食材名称、分类..."
              style={{ width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10, fontSize: 14, border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff', boxSizing: 'border-box' }} />
            {search && (
              <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', color: '#94a3b8', fontSize: 18, lineHeight: 1 }}>×</button>
            )}
          </div>

          {/* 分类筛选 */}
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
              {search ? '没有找到匹配的物品' : '食品是空的，点击上方添加'}
            </p>
          ) : (
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
                                      <IngredientCard key={item.id} item={item} onDelete={deleteItem} onUpdate={updateItem} />
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
        </>
      )}

      {showManual && <ManualAddModal onClose={() => setShowManual(false)} onSaved={fetchItems} />}
      {showPhoto && <PhotoAddModal onClose={() => setShowPhoto(false)} onSaved={fetchItems} />}
      {showBarcode && <BarcodeModal onClose={() => setShowBarcode(false)} onSaved={fetchItems} />}
    </div>
  )
}