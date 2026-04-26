import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { callAI, fileToBase64 } from '../lib/aiRecognition'

function parseJSON(text) {
  try {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (match) return JSON.parse(match[0])
  } catch (e) { console.error('解析失败', e) }
  return null
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

// ── 编辑弹窗 ──────────────────────────────────────────────
function EditDiningModal({ record, onClose, onSaved }) {
  const [header, setHeader] = useState({
    dining_type: record.dining_type,
    meal_time: record.meal_time || null,
    dined_at: record.dined_at,
    dined_time: record.dined_time || '',
    store_name: record.store_name || '',
    store_name_original: record.store_name_original || '',
    amount: record.amount || '',
    memo: record.memo || ''
  })
  const [items, setItems] = useState(
    (record.dining_items || []).map(i => ({ ...i, price: i.price || '', quantity: i.quantity || 1 }))
  )
  const [saving, setSaving] = useState(false)

  function setItemField(i, k, v) {
    setItems(items => { const n = [...items]; n[i] = { ...n[i], [k]: v }; return n })
  }

  async function save() {
    if (header.dining_type === 'out' && (!header.store_name.trim() || !header.dined_at || !header.amount)) {
      return alert('外食记录需要填写店名、日期和金额')
    }
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

    // 删除旧明细重新插入
    await supabase.from('dining_items').delete().eq('dining_id', record.id)
    const validItems = items.filter(i => i.name_zh?.trim())
    if (validItems.length > 0) {
      await supabase.from('dining_items').insert(
        validItems.map(item => ({
          dining_id: record.id,
          name_zh: item.name_zh,
          name_original: item.name_original || null,
          quantity: Number(item.quantity) || 1,
          unit: item.unit || (header.dining_type === 'home' ? '人份' : '份'),
          price: item.price ? Number(item.price) : null
        }))
      )
    }
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>编辑餐饮记录</div>
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
              <input style={smallField} type="date" value={header.dined_at}
                onChange={e => setHeader(h => ({ ...h, dined_at: e.target.value }))} />
            </div>
            {header.dining_type === 'out' && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>时间</div>
                <input style={smallField} type="time" value={header.dined_time}
                  onChange={e => setHeader(h => ({ ...h, dined_time: e.target.value }))} />
              </div>
            )}
          </div>

          {header.dining_type === 'out' && (
            <>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>店名（中文）</div>
                <input style={smallField} value={header.store_name}
                  onChange={e => setHeader(h => ({ ...h, store_name: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>店名原文</div>
                <input style={smallField} value={header.store_name_original}
                  onChange={e => setHeader(h => ({ ...h, store_name_original: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>金额（¥）</div>
                <input style={smallField} type="number" value={header.amount}
                  onChange={e => setHeader(h => ({ ...h, amount: e.target.value }))} />
              </div>
            </>
          )}

          <div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>备注</div>
            <input style={smallField} value={header.memo}
              onChange={e => setHeader(h => ({ ...h, memo: e.target.value }))} />
          </div>

          {/* 菜品明细 */}
          <div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>菜品明细</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((item, i) => (
                <div key={i} style={{ background: '#f8fafc', borderRadius: 9, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input style={{ ...smallField, flex: 2 }} value={item.name_zh || ''}
                      placeholder="菜品名称"
                      onChange={e => setItemField(i, 'name_zh', e.target.value)} />
                    <button onClick={() => setItems(items => items.filter((_, j) => j !== i))}
                      style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>份数</div>
                      <input style={smallField} type="number" value={item.quantity}
                        onChange={e => setItemField(i, 'quantity', e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>单价（¥）</div>
                      <input style={smallField} type="number" value={item.price}
                        placeholder="可选"
                        onChange={e => setItemField(i, 'price', e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>小计</div>
                      <div style={{ padding: '7px 8px', borderRadius: 8, background: '#fff', border: '1.5px solid #e2e8f0', fontSize: 13, fontWeight: 600, color: '#f97316' }}>
                        {item.price && item.quantity ? `¥${(Number(item.price) * Number(item.quantity)).toFixed(0)}` : '-'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setItems(i => [...i, { name_zh: '', quantity: 1, unit: header.dining_type === 'home' ? '人份' : '份', price: '' }])}
              style={{ marginTop: 8, width: '100%', padding: '8px 0', borderRadius: 8, background: '#f1f5f9', color: '#475569', fontSize: 13, fontWeight: 600 }}>
              + 添加菜品
            </button>
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

// ── 录入弹窗 ──────────────────────────────────────────────
function AddDiningModal({ onClose, onSaved }) {
  const [step, setStep] = useState('type')
  const [diningType, setDiningType] = useState(null)
  const [mealTime, setMealTime] = useState(null)
  const [dinedAt, setDinedAt] = useState(new Date().toISOString().split('T')[0])
  const [dinedTime, setDinedTime] = useState('')

  const [homeMode, setHomeMode] = useState(null)
  const [homeItems, setHomeItems] = useState([{ name_zh: '', quantity: 1, unit: '人份', price: '' }])
  const [ingredients, setIngredients] = useState([])
  const [selectedIngredients, setSelectedIngredients] = useState({})
  const [aiHomeItems, setAiHomeItems] = useState([])

  const [outMode, setOutMode] = useState(null)
  const [storeName, setStoreName] = useState('')
  const [storeNameOriginal, setStoreNameOriginal] = useState('')
  const [amount, setAmount] = useState('')
  const [outItems, setOutItems] = useState([])
  const [billData, setBillData] = useState(null)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [memo, setMemo] = useState('')

  useEffect(() => {
    if (homeMode === 'select') fetchIngredients()
  }, [homeMode])

  async function fetchIngredients() {
    const { data } = await supabase
      .from('ingredients')
      .select('id, name_zh, name_original, category, unit, consumed_quantity, quantity, created_at')
      .order('created_at', { ascending: false })
    setIngredients((data || []).filter(i => (i.quantity || 0) > (i.consumed_quantity || 0)))
  }

  async function recognizeDish(files) {
    setLoading(true)
    try {
      const parts = []
      for (const file of files) {
        const base64 = await fileToBase64(file)
        parts.push({ type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: base64 } })
      }
      parts.push({ type: 'text', text: `识别图片中的菜品，输出JSON数组，每项包含：
{"name_zh":"中文菜名","name_original":"日文或英文原名（可空）","quantity":1,"unit":"人份"}
支持中日英文识别，统一翻译成中文。只输出JSON数组。` })
      const text = await callAI([{ role: 'user', content: parts }])
      const result = parseJSON(text)
      if (Array.isArray(result)) setAiHomeItems(result.map(i => ({ ...i, quantity: i.quantity || 1, unit: i.unit || '人份', price: '' })))
    } catch (e) { alert('识别失败：' + e.message) }
    setLoading(false)
  }

  async function recognizeBill(files) {
    setLoading(true)
    try {
      const parts = []
      for (const file of files) {
        const base64 = await fileToBase64(file)
        parts.push({ type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: base64 } })
      }
      parts.push({ type: 'text', text: `识别这张餐饮账单（支持中日英文），输出JSON：
{
  "store_name": "店名中文",
  "store_name_original": "店名原文",
  "dined_at": "就餐日期YYYY-MM-DD或空字符串",
  "dined_time": "就餐时间HH:MM或空字符串",
  "amount": 合计金额数字或null,
  "items": [{"name_zh":"菜品中文名","name_original":"原文","quantity":数量数字,"unit":"份","price":单价数字或null}]
}
注意：price是单价，quantity是份数。只输出JSON。` })
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
      parts.push({ type: 'text', text: `识别图片中的餐厅菜品（支持中日英文），输出JSON数组：
[{"name_zh":"菜品中文名","name_original":"原文名（可空）","quantity":1,"unit":"份"}]
只输出JSON数组。` })
      const text = await callAI([{ role: 'user', content: parts }])
      const result = parseJSON(text)
      if (Array.isArray(result)) setOutItems(prev => [...prev, ...result.map(i => ({ ...i, price: '' }))])
    } catch (e) { alert('识别失败：' + e.message) }
    setLoading(false)
  }

  const setAiItemField = useCallback((i, k, v) => {
    setAiHomeItems(items => { const n = [...items]; n[i] = { ...n[i], [k]: v }; return n })
  }, [])

  const setOutItemField = useCallback((i, k, v) => {
    setOutItems(items => { const n = [...items]; n[i] = { ...n[i], [k]: v }; return n })
  }, [])

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
      memo: memo || null
    }).select().single()
    console.log('dining error check:', dining)

    if (dining) {
      let items = []
      if (diningType === 'home') {
        if (homeMode === 'manual') items = homeItems.filter(i => i.name_zh.trim())
        else if (homeMode === 'select') {
          items = Object.keys(selectedIngredients).filter(id => selectedIngredients[id]).map(id => {
            const ing = ingredients.find(i => i.id === id)
            return { name_zh: ing.name_zh, name_original: ing.name_original, quantity: 1, unit: '人份', price: '' }
          })
        } else if (homeMode === 'photo') items = aiHomeItems
      } else {
        items = outItems
      }

      if (items.length > 0) {
        await supabase.from('dining_items').insert(
          items.map(item => ({
            dining_id: dining.id,
            name_zh: item.name_zh,
            name_original: item.name_original || null,
            quantity: Number(item.quantity) || 1,
            unit: item.unit || (diningType === 'home' ? '人份' : '份'),
            price: item.price ? Number(item.price) : null,
          }))
        )
      }
    }
    setSaving(false)
    onSaved()
    onClose()
  }

  const canSave = diningType && (
    diningType === 'home'
      ? mealTime && (
          homeMode === 'manual' ? homeItems.some(i => i.name_zh.trim()) :
          homeMode === 'select' ? Object.values(selectedIngredients).some(Boolean) :
          homeMode === 'photo' ? aiHomeItems.length > 0 : false
        )
      : (storeName.trim() && dinedAt && amount)
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>记录餐饮</div>
          <button onClick={onClose} style={{ background: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>就餐日期</div>
          <input style={field} type="date" value={dinedAt} onChange={e => setDinedAt(e.target.value)} />
        </div>

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

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>类型</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[['home','🍳 自炊'],['out','🍽️ 外食']].map(([id, label]) => (
              <button key={id} onClick={() => { setDiningType(id); setHomeMode(null); setOutMode(null) }} style={{
                padding: '12px 0', borderRadius: 10, fontSize: 14, fontWeight: 600,
                background: diningType === id ? (id === 'home' ? '#16a34a' : '#f97316') : '#f1f5f9',
                color: diningType === id ? '#fff' : '#94a3b8'
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* 自炊录入方式 */}
        {diningType === 'home' && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>录入方式</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
              {[['manual','✏️','手动'],['select','📦','从库存选'],['photo','📷','拍照识别']].map(([id, icon, label]) => (
                <button key={id} onClick={() => setHomeMode(id)} style={{
                  padding: '8px 0', borderRadius: 9, fontSize: 12, fontWeight: 600,
                  background: homeMode === id ? '#16a34a' : '#f1f5f9',
                  color: homeMode === id ? '#fff' : '#94a3b8',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
                }}>
                  <span style={{ fontSize: 18 }}>{icon}</span>{label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 自炊 - 手动录入（带单价） */}
        {diningType === 'home' && homeMode === 'manual' && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>菜品列表</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {homeItems.map((item, i) => (
                <div key={i} style={{ background: '#f8fafc', borderRadius: 9, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input style={{ ...smallField, flex: 1 }} value={item.name_zh} placeholder="菜品名称"
                      onChange={e => setHomeItems(items => { const n=[...items]; n[i]={...n[i],name_zh:e.target.value}; return n })} />
                    {homeItems.length > 1 && (
                      <button onClick={() => setHomeItems(items => items.filter((_, j) => j !== i))}
                        style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>份数</div>
                      <input style={smallField} type="number" value={item.quantity}
                        onChange={e => setHomeItems(items => { const n=[...items]; n[i]={...n[i],quantity:e.target.value}; return n })} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>单位</div>
                      <select style={smallField} value={item.unit}
                        onChange={e => setHomeItems(items => { const n=[...items]; n[i]={...n[i],unit:e.target.value}; return n })}>
                        {['人份','个','碗','盘','杯'].map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>单价（¥）</div>
                      <input style={smallField} type="number" value={item.price} placeholder="可选"
                        onChange={e => setHomeItems(items => { const n=[...items]; n[i]={...n[i],price:e.target.value}; return n })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setHomeItems(i => [...i, { name_zh: '', quantity: 1, unit: '人份', price: '' }])}
              style={{ marginTop: 8, width: '100%', padding: '8px 0', borderRadius: 8, background: '#f1f5f9', color: '#475569', fontSize: 13, fontWeight: 600 }}>
              + 添加菜品
            </button>
          </div>
        )}

        {/* 自炊 - 从库存选 */}
        {diningType === 'home' && homeMode === 'select' && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>选择使用的食材</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
              {ingredients.map(ing => (
                <div key={ing.id} onClick={() => setSelectedIngredients(s => ({ ...s, [ing.id]: !s[ing.id] }))}
                  style={{
                    padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                    background: selectedIngredients[ing.id] ? '#f0fdf4' : '#f8fafc',
                    border: `1.5px solid ${selectedIngredients[ing.id] ? '#16a34a' : '#e2e8f0'}`,
                    display: 'flex', alignItems: 'center', gap: 10
                  }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                    border: `2px solid ${selectedIngredients[ing.id] ? '#16a34a' : '#cbd5e1'}`,
                    background: selectedIngredients[ing.id] ? '#16a34a' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    {selectedIngredients[ing.id] && <span style={{ color: '#fff', fontSize: 12 }}>✓</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{ing.name_zh}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      剩余 {(ing.quantity || 0) - (ing.consumed_quantity || 0)}{ing.unit}
                      {ing.category && ` · ${ing.category}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 自炊 - 拍照识别 */}
        {diningType === 'home' && homeMode === 'photo' && (
          <div style={{ marginBottom: 14 }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#16a34a' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✨</div>识别中...
              </div>
            ) : aiHomeItems.length === 0 ? (
              <div>
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} id="home-dish-input"
                  onChange={e => recognizeDish(Array.from(e.target.files))} />
                <button onClick={() => document.getElementById('home-dish-input').click()} style={{
                  width: '100%', padding: '30px 0', borderRadius: 12,
                  border: '2px dashed #cbd5e1', background: '#f8fafc',
                  color: '#64748b', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6
                }}>
                  <span style={{ fontSize: 36 }}>📷</span>
                  <span style={{ fontWeight: 600 }}>拍摄或选择菜品照片</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>支持多张图片</span>
                </button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>识别到 {aiHomeItems.length} 道菜品：</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {aiHomeItems.map((item, i) => (
                    <div key={i} style={{ background: '#f8fafc', borderRadius: 9, padding: '8px 10px' }}>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <input style={{ ...smallField, flex: 1 }} value={item.name_zh}
                          onChange={e => setAiItemField(i, 'name_zh', e.target.value)} />
                        <button onClick={() => setAiHomeItems(items => items.filter((_, j) => j !== i))}
                          style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1 }}>×</button>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>份数</div>
                          <input style={smallField} type="number" value={item.quantity}
                            onChange={e => setAiItemField(i, 'quantity', e.target.value)} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>单价（¥）</div>
                          <input style={smallField} type="number" value={item.price || ''}
                            placeholder="可选"
                            onChange={e => setAiItemField(i, 'price', e.target.value)} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={() => setAiHomeItems([])}
                  style={{ marginTop: 8, width: '100%', padding: '7px 0', borderRadius: 8, background: '#f1f5f9', color: '#475569', fontSize: 13 }}>
                  重新识别
                </button>
              </div>
            )}
          </div>
        )}

        {/* 外食录入方式 */}
        {diningType === 'out' && (
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
        )}

        {/* 外食 - 账单拍照 */}
        {diningType === 'out' && outMode === 'bill' && (
          <div style={{ marginBottom: 14 }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#f97316' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✨</div>识别中...
              </div>
            ) : !billData ? (
              <div>
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} id="bill-input"
                  onChange={e => recognizeBill(Array.from(e.target.files))} />
                <button onClick={() => document.getElementById('bill-input').click()} style={{
                  width: '100%', padding: '30px 0', borderRadius: 12,
                  border: '2px dashed #fed7aa', background: '#fff7ed',
                  color: '#9a3412', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6
                }}>
                  <span style={{ fontSize: 36 }}>🧾</span>
                  <span style={{ fontWeight: 600 }}>拍摄或选择账单照片</span>
                  <span style={{ fontSize: 12, color: '#c2410c' }}>支持中日英文账单</span>
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ background: '#fff7ed', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#9a3412' }}>
                  已识别账单，请确认以下信息
                </div>
                {outItems.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>识别到 {outItems.length} 道菜品：</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {outItems.map((item, i) => (
                        <div key={i} style={{ background: '#f8fafc', borderRadius: 9, padding: '8px 10px' }}>
                          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                            <input style={{ ...smallField, flex: 1 }} value={item.name_zh}
                              onChange={e => setOutItemField(i, 'name_zh', e.target.value)} />
                            <button onClick={() => setOutItems(items => items.filter((_, j) => j !== i))}
                              style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1 }}>×</button>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>份数</div>
                              <input style={smallField} type="number" value={item.quantity || 1}
                                onChange={e => setOutItemField(i, 'quantity', e.target.value)} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>单价（¥）</div>
                              <input style={smallField} type="number" value={item.price || ''}
                                placeholder="单价"
                                onChange={e => setOutItemField(i, 'price', e.target.value)} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>小计</div>
                              <div style={{ padding: '7px 8px', borderRadius: 8, background: '#fff', border: '1.5px solid #e2e8f0', fontSize: 13, fontWeight: 600, color: '#f97316' }}>
                                {item.price && item.quantity ? `¥${(Number(item.price) * Number(item.quantity)).toFixed(0)}` : '-'}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={() => { setBillData(null); setOutItems([]) }}
                  style={{ padding: '7px 0', borderRadius: 8, background: '#f1f5f9', color: '#475569', fontSize: 13 }}>
                  重新识别
                </button>
              </div>
            )}
          </div>
        )}

        {/* 外食 - 菜品拍照 */}
        {diningType === 'out' && outMode === 'dish' && (
          <div style={{ marginBottom: 14 }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#f97316' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✨</div>识别中...
              </div>
            ) : (
              <div>
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} id="out-dish-input"
                  onChange={e => recognizeOutDish(Array.from(e.target.files))} />
                <button onClick={() => document.getElementById('out-dish-input').click()} style={{
                  width: '100%', padding: '24px 0', borderRadius: 12,
                  border: '2px dashed #fed7aa', background: '#fff7ed',
                  color: '#9a3412', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  marginBottom: outItems.length ? 10 : 0
                }}>
                  <span style={{ fontSize: 32 }}>📷</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{outItems.length ? '继续添加照片' : '拍摄或选择菜品照片'}</span>
                  <span style={{ fontSize: 12, color: '#c2410c' }}>支持多张图片</span>
                </button>
                {outItems.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {outItems.map((item, i) => (
                      <div key={i} style={{ background: '#f8fafc', borderRadius: 9, padding: '8px 10px' }}>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          <input style={{ ...smallField, flex: 1 }} value={item.name_zh}
                            onChange={e => setOutItemField(i, 'name_zh', e.target.value)} />
                          <button onClick={() => setOutItems(items => items.filter((_, j) => j !== i))}
                            style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1 }}>×</button>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>份数</div>
                            <input style={smallField} type="number" value={item.quantity || 1}
                              onChange={e => setOutItemField(i, 'quantity', e.target.value)} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>单价（¥）</div>
                            <input style={smallField} type="number" value={item.price || ''}
                              placeholder="可选"
                              onChange={e => setOutItemField(i, 'price', e.target.value)} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 外食必填信息 */}
        {diningType === 'out' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>店名、日期、金额为必填项</div>
            <input style={field} value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="店名（中文）*" />
            <input style={field} value={storeNameOriginal} onChange={e => setStoreNameOriginal(e.target.value)} placeholder="店名原文（可选）" />
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...field, flex: 1 }} type="date" value={dinedAt} onChange={e => setDinedAt(e.target.value)} />
              <input style={{ ...field, flex: 1 }} type="time" value={dinedTime} onChange={e => setDinedTime(e.target.value)} placeholder="时间（可选）" />
            </div>
            <input style={field} type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="金额（¥）*" />
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
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
  const [collapsedMonths, setCollapsedMonths] = useState({})
  const [editingRecord, setEditingRecord] = useState(null)
  const [collapsedYears, setCollapsedYears] = useState({})

  useEffect(() => { fetchRecords() }, [])

  async function fetchRecords() {
    setLoading(true)
    const { data } = await supabase
      .from('dining_history')
      .select(`*, dining_items(*)`)
      .order('dined_at', { ascending: false })
    setRecords(data || [])
    setLoading(false)
  }

  async function deleteRecord(id) {
    await supabase.from('dining_history').delete().eq('id', id)
    setRecords(records.filter(r => r.id !== id))
  }

  const filtered = records.filter(r => {
    if (!search) return true
    const s = search.toLowerCase()
    return r.store_name?.toLowerCase().includes(s) ||
      r.memo?.toLowerCase().includes(s) ||
      r.dining_items?.some(i => i.name_zh?.toLowerCase().includes(s))
  })

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

  const totalCount = filtered.length


  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>🍽️ 餐饮履历</h1>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>共 {totalCount} 条</span>
        </div>
        <button onClick={() => setShowAdd(true)} style={{
          padding: '7px 16px', borderRadius: 10, background: '#f97316',
          color: '#fff', fontSize: 14, fontWeight: 600
        }}>+ 记录</button>
      </div>

      <div style={{ position: 'relative', marginBottom: 16 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: '#94a3b8', pointerEvents: 'none' }}>🔍</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索店名、菜品..."
          style={{ width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10, fontSize: 14, border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff', boxSizing: 'border-box' }} />
        {search && (
          <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', color: '#94a3b8', fontSize: 18, lineHeight: 1 }}>×</button>
        )}
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
            const yearTotal = yearRecords.reduce((sum, r) => sum + (r.amount || 0), 0)
            const isYearCollapsed = collapsedYears[year]

            return (
              <div key={year} style={{ border: '1px solid #f1f5f9', borderRadius: 12, overflow: 'hidden' }}>
                {/* 年份标题 */}
                <div onClick={() => setCollapsedYears(c => ({ ...c, [year]: !c[year] }))}
                  style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f8fafc' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#334155' }}>{year}</span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>{yearRecords.length} 条</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {yearTotal > 0 && (
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#f97316' }}>¥{yearTotal.toLocaleString()}</span>
                    )}
                    <span style={{ fontSize: 14, color: '#94a3b8' }}>{isYearCollapsed ? '▼' : '▲'}</span>
                  </div>
                </div>

                {!isYearCollapsed && (
                  <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {Object.entries(months).map(([month, days]) => {
                      const monthRecords = Object.values(days).flat()
                      const monthTotal = monthRecords.reduce((sum, r) => sum + (r.amount || 0), 0)
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              {monthTotal > 0 && (
                                <span style={{ fontSize: 13, fontWeight: 600, color: '#f97316' }}>¥{monthTotal.toLocaleString()}</span>
                              )}
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
                                        <div style={{ padding: '12px 14px' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div style={{ flex: 1, cursor: 'pointer' }}
                                              onClick={() => setExpanded(e => ({ ...e, [r.id]: !e[r.id] }))}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {r.meal_time && (
                                                  <>
                                                    <span style={{ fontSize: 16 }}>{mealIcon[r.meal_time]}</span>
                                                    <span style={{ fontWeight: 600, fontSize: 14 }}>{mealLabel[r.meal_time]}</span>
                                                  </>
                                                )}
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
                                              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                                                {r.dining_items?.length > 0 ? `${r.dining_items.length} 道菜品` : '无明细'}
                                              </div>
                                              {r.memo && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>备注：{r.memo}</div>}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                              <button onClick={() => setEditingRecord(r)} style={{ background: '#f1f5f9', color: '#475569', fontSize: 13, padding: '5px 10px', borderRadius: 7, fontWeight: 600 }}>编辑</button>
                                              <button onClick={() => deleteRecord(r.id)} style={{ background: '#fef2f2', color: '#ef4444', fontSize: 13, padding: '5px 10px', borderRadius: 7, fontWeight: 600 }}>删除</button>
                                              <div onClick={() => setExpanded(e => ({ ...e, [r.id]: !e[r.id] }))}
                                                style={{ fontSize: 16, color: '#94a3b8', cursor: 'pointer', padding: '0 4px' }}>
                                                {expanded[r.id] ? '▲' : '▼'}
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                        {expanded[r.id] && r.dining_items?.length > 0 && (
                                          <div style={{ borderTop: '1px solid #f1f5f9' }}>
                                            {r.dining_items.map((item, idx) => (
                                              <div key={idx} style={{ padding: '9px 14px', borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                  <div style={{ fontSize: 14, fontWeight: 500 }}>{item.name_zh}</div>
                                                  {item.name_original && <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.name_original}</div>}
                                                </div>
                                                <div style={{ textAlign: 'right', fontSize: 13 }}>
                                                  <div style={{ color: '#64748b' }}>{item.quantity}{item.unit}</div>
                                                  {item.price && (
                                                    <div style={{ fontWeight: 600, color: '#f97316' }}>
                                                      {item.quantity > 1 && (
                                                        <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 4 }}>¥{item.price}×{item.quantity}</span>
                                                      )}
                                                      ¥{(Number(item.price) * Number(item.quantity)).toFixed(0)}
                                                    </div>
                                                  )}
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
      {editingRecord && (
        <EditDiningModal
          record={editingRecord}
          onClose={() => setEditingRecord(null)}
          onSaved={() => { fetchRecords(); setEditingRecord(null) }}
        />
      )}
    </div>
  )
}