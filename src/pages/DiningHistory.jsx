import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function callAI(messages) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/claude-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
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
  } catch (e) { console.error('解析失败', e) }
  return null
}

const MEAL_TIMES = [
  { id: 'breakfast', label: '早餐', icon: '🌅' },
  { id: 'lunch', label: '午餐', icon: '☀️' },
  { id: 'dinner', label: '晚餐', icon: '🌙' },
  { id: 'snack', label: '点心', icon: '🍪' },
]

const smallField = {
  width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13,
  border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
}
const field = {
  width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 15,
  border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
}

// ── 录入弹窗 ──────────────────────────────────────────────
function AddDiningModal({ onClose, onSaved }) {
  const [step, setStep] = useState('type') // type → mealtime → input
  const [diningType, setDiningType] = useState(null) // 'home' | 'out'
  const [mealTime, setMealTime] = useState(null)
  const [dinedAt, setDinedAt] = useState(new Date().toISOString().split('T')[0])

  // 自炊
  const [homeMode, setHomeMode] = useState(null) // 'manual' | 'select' | 'photo'
  const [homeItems, setHomeItems] = useState([{ name_zh: '', quantity: 1, unit: '人份' }])
  const [ingredients, setIngredients] = useState([])
  const [selectedIngredients, setSelectedIngredients] = useState({})
  const [aiHomeItems, setAiHomeItems] = useState([])
  const [homePhotos, setHomePhotos] = useState([])

  // 外食
  const [outMode, setOutMode] = useState(null) // 'bill' | 'dish'
  const [storeName, setStoreName] = useState('')
  const [storeNameOriginal, setStoreNameOriginal] = useState('')
  const [amount, setAmount] = useState('')
  const [outItems, setOutItems] = useState([])
  const [outPhotos, setOutPhotos] = useState([])
  const [billData, setBillData] = useState(null)
  const [dinedTime, setDinedTime] = useState('')

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

  // 自炊拍照识别
  async function recognizeDish(files) {
    setLoading(true)
    try {
      const parts = []
      for (const file of files) {
        const base64 = await fileToBase64(file)
        parts.push({ type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: base64 } })
      }
      parts.push({ type: 'text', text: `识别图片中的菜品，输出JSON数组，每项包含：
{"name_zh":"中文菜名","name_original":"日文或英文原名（可空）","category":"菜品分类","quantity":1,"unit":"人份"}
支持中日英文识别，统一翻译成中文。只输出JSON数组。` })
      const text = await callAI([{ role: 'user', content: parts }])
      const result = parseJSON(text)
      if (Array.isArray(result)) setAiHomeItems(result.map(i => ({ ...i, quantity: i.quantity || 1, unit: i.unit || '人份' })))
    } catch (e) { alert('识别失败：' + e.message) }
    setLoading(false)
  }

  // 外食账单识别
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
        注意：price是单价，quantity是份数，小计=price×quantity
      }
      只输出JSON。` })
      const text = await callAI([{ role: 'user', content: parts }])
      const result = parseJSON(text)
      if (result) {
      setBillData(result)
      setStoreName(result.store_name || '')
      setStoreNameOriginal(result.store_name_original || '')
      if (result.dined_at) setDinedAt(result.dined_at)
      if (result.dined_time) setDinedTime(result.dined_time)
      if (result.amount) setAmount(String(result.amount))
      setOutItems(result.items || [])
    }
    } catch (e) { alert('识别失败：' + e.message) }
    setLoading(false)
  }

  // 外食菜品拍照识别
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
      if (Array.isArray(result)) setOutItems(prev => [...prev, ...result])
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
    // 验证外食必填字段
    if (diningType === 'out' && (!storeName.trim() || !dinedAt || !amount)) {
      alert('外食记录需要填写店名、就餐日期和金额')
      return
    }
    setSaving(true)

    const { data: dining, error: diningError } = await supabase.from('dining_history').insert({
      dining_type: diningType,
      meal_time: mealTime || null,
      dined_at: dinedAt,
      dined_time: diningType === 'out' ? (dinedTime || null) : null,
      store_name: diningType === 'out' ? storeName : null,
      store_name_original: diningType === 'out' ? storeNameOriginal : null,
      amount: diningType === 'out' && amount ? Number(amount) : null,
      memo: memo || null
    }).select().single()

    console.log('dining error:', JSON.stringify(diningError))
    console.log('dining data:', JSON.stringify(dining))

    if (dining) {
      let items = []
      if (diningType === 'home') {
        if (homeMode === 'manual') {
          items = homeItems.filter(i => i.name_zh.trim())
        } else if (homeMode === 'select') {
          items = Object.keys(selectedIngredients)
            .filter(id => selectedIngredients[id])
            .map(id => {
              const ing = ingredients.find(i => i.id === id)
              return { name_zh: ing.name_zh, name_original: ing.name_original, category: ing.category, quantity: 1, unit: '人份', ingredient_id: id }
            })
        } else if (homeMode === 'photo') {
          items = aiHomeItems
        }
      } else {
        items = outItems
      }

      if (items.length > 0) {
        await supabase.from('dining_items').insert(
          items.map(item => ({
            dining_id: dining.id,
            name_zh: item.name_zh,
            name_original: item.name_original || null,
            category: item.category || null,
            quantity: Number(item.quantity) || 1,
            unit: item.unit || '人份',
            price: item.price ? Number(item.price) : null,
            ingredient_id: item.ingredient_id || null
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
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        background: '#fff', borderRadius: '16px 16px 0 0', padding: 20,
        width: '100%', maxWidth: 430, maxHeight: '90vh', overflowY: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>记录餐饮</div>
          <button onClick={onClose} style={{ background: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        {/* 就餐时间 */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>就餐日期</div>
          <input style={field} type="date" value={dinedAt} onChange={e => setDinedAt(e.target.value)} />
        </div>

        {/* 餐次选择 */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
            餐次{diningType === 'out' ? '（可选，账单有时间则自动填入）' : '*'}
          </div>
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
          {diningType === 'out' && dinedTime && !mealTime && (
            <div style={{ fontSize: 12, color: '#f97316', marginTop: 4 }}>
              账单时间：{dinedTime}
            </div>
          )}
        </div>
        {/* 自炊/外食 */}
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

        {/* 自炊 - 手动录入 */}
        {diningType === 'home' && homeMode === 'manual' && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>菜品列表</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {homeItems.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input style={{ ...smallField, flex: 2 }} value={item.name_zh} placeholder="菜品名称"
                    onChange={e => setHomeItems(items => { const n=[...items]; n[i]={...n[i],name_zh:e.target.value}; return n })} />
                  <input style={{ ...smallField, flex: 1, textAlign: 'center' }} type="number" value={item.quantity}
                    onChange={e => setHomeItems(items => { const n=[...items]; n[i]={...n[i],quantity:e.target.value}; return n })} />
                  <select style={{ ...smallField, flex: 1 }} value={item.unit}
                    onChange={e => setHomeItems(items => { const n=[...items]; n[i]={...n[i],unit:e.target.value}; return n })}>
                    {['人份','个','碗','盘','杯'].map(u => <option key={u}>{u}</option>)}
                  </select>
                  {homeItems.length > 1 && (
                    <button onClick={() => setHomeItems(items => items.filter((_, j) => j !== i))}
                      style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={() => setHomeItems(i => [...i, { name_zh: '', quantity: 1, unit: '人份' }])}
              style={{ marginTop: 8, width: '100%', padding: '8px 0', borderRadius: 8, background: '#f1f5f9', color: '#475569', fontSize: 13, fontWeight: 600 }}>
              + 添加菜品
            </button>
          </div>
        )}

        {/* 自炊 - 从库存选 */}
        {diningType === 'home' && homeMode === 'select' && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>选择使用的食材（优先显示最近消耗）</div>
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
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>支持多张图片，识别中日英文</span>
                </button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>识别到 {aiHomeItems.length} 道菜品：</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {aiHomeItems.map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6 }}>
                      <input style={{ ...smallField, flex: 2 }} value={item.name_zh}
                        onChange={e => setAiItemField(i, 'name_zh', e.target.value)} />
                      <input style={{ ...smallField, flex: 1, textAlign: 'center' }} type="number" value={item.quantity}
                        onChange={e => setAiItemField(i, 'quantity', e.target.value)} />
                      <button onClick={() => setAiHomeItems(items => items.filter((_, j) => j !== i))}
                        style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1 }}>×</button>
                    </div>
                  ))}
                </div>
                <button onClick={() => setAiHomeItems([])} style={{
                  marginTop: 8, width: '100%', padding: '7px 0', borderRadius: 8,
                  background: '#f1f5f9', color: '#475569', fontSize: 13
                }}>重新识别</button>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ background: '#fff7ed', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#9a3412' }}>
                  已识别账单，请确认以下信息
                </div>
                {outItems.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>识别到 {outItems.length} 道菜品：</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {outItems.map((item, i) => (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', background: '#f8fafc', borderRadius: 8 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input style={{ ...smallField, flex: 2 }} value={item.name_zh}
                              onChange={e => setOutItemField(i, 'name_zh', e.target.value)} />
                            <button onClick={() => setOutItems(items => items.filter((_, j) => j !== i))}
                              style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
                              <div style={{
                                padding: '7px 10px', borderRadius: 8, background: '#fff',
                                border: '1.5px solid #e2e8f0', fontSize: 13, fontWeight: 600, color: '#f97316'
                              }}>
                                {item.price && item.quantity
                                  ? `¥${(Number(item.price) * Number(item.quantity)).toFixed(0)}`
                                  : '-'}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={() => { setBillData(null); setOutItems([]) }} style={{
                  padding: '7px 0', borderRadius: 8, background: '#f1f5f9', color: '#475569', fontSize: 13
                }}>重新识别</button>
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
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    {outItems.length ? '继续添加照片' : '拍摄或选择菜品照片'}
                  </span>
                  <span style={{ fontSize: 12, color: '#c2410c' }}>支持多张图片</span>
                </button>
                {outItems.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {outItems.map((item, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6 }}>
                        <input style={{ ...smallField, flex: 2 }} value={item.name_zh}
                          onChange={e => setOutItemField(i, 'name_zh', e.target.value)} />
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

        {/* 外食必填信息 */}
        {diningType === 'out' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 2 }}>
              店名、日期、金额为必填项
            </div>
            <input style={field} value={storeName} onChange={e => setStoreName(e.target.value)}
              placeholder="店名（中文）*" />
            <input style={field} value={storeNameOriginal} onChange={e => setStoreNameOriginal(e.target.value)}
              placeholder="店名原文（可选）" />
            <input style={field} type="date" value={dinedAt} onChange={e => setDinedAt(e.target.value)} />
            <input style={field} type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="金额（¥）*" />
          </div>
        )}

        {/* 备注 */}
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

  // 按月分组，月内按日期+餐次排序
  const grouped = {}
  filtered.forEach(r => {
    const d = new Date(r.dined_at)
    const monthKey = `${d.getFullYear()}年${d.getMonth() + 1}月`
    if (!grouped[monthKey]) grouped[monthKey] = {}
    const dayKey = r.dined_at
    if (!grouped[monthKey][dayKey]) grouped[monthKey][dayKey] = []
    grouped[monthKey][dayKey].push(r)
  })

  const mealOrder = { breakfast: 0, lunch: 1, dinner: 2, snack: 3, null: 4 }
  const mealLabel = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '点心' }
  const mealIcon = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍪' }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>🍽️ 餐饮履历</h1>
        <button onClick={() => setShowAdd(true)} style={{
          padding: '7px 16px', borderRadius: 10, background: '#f97316',
          color: '#fff', fontSize: 14, fontWeight: 600
        }}>+ 记录</button>
      </div>

      <div style={{ position: 'relative', marginBottom: 16 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: '#94a3b8', pointerEvents: 'none' }}>🔍</span>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜索店名、菜品..."
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {Object.entries(grouped).map(([month, days]) => (
            <div key={month}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8, paddingBottom: 6, borderBottom: '1.5px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}>
                <span>{month}</span>
                <span style={{ color: '#f97316' }}>
                  {Object.values(days).flat().reduce((sum, r) => sum + (r.amount || 0), 0) > 0
                    ? `¥${Object.values(days).flat().reduce((sum, r) => sum + (r.amount || 0), 0).toLocaleString()}`
                    : ''}
                </span>
              </div>
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
            {r.dining_items?.length > 0
              ? `${r.dining_items.length} 道菜品`
              : '无明细'}
          </div>
          {r.memo && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>备注：{r.memo}</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={() => deleteRecord(r.id)} style={{
            background: '#fef2f2', color: '#ef4444', fontSize: 13,
            padding: '5px 10px', borderRadius: 7, fontWeight: 600
          }}>删除</button>
          <div onClick={() => setExpanded(e => ({ ...e, [r.id]: !e[r.id] }))}
            style={{ fontSize: 16, color: '#94a3b8', cursor: 'pointer', padding: '0 4px' }}>
            {expanded[r.id] ? '▲' : '▼'}
          </div>
        </div>
      </div>
    </div>

    {/* 明细展开 */}
    {expanded[r.id] && r.dining_items?.length > 0 && (
      <div style={{ borderTop: '1px solid #f1f5f9' }}>
        {r.dining_items.map((item, idx) => (
          <div key={idx} style={{
            padding: '9px 14px', borderBottom: '1px solid #f8fafc',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{item.name_zh}</div>
              {item.name_original && (
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.name_original}</div>
              )}
            </div>
            <div style={{ textAlign: 'right', fontSize: 13 }}>
              <div style={{ color: '#64748b' }}>
                {item.quantity}{item.unit}
              </div>
              {item.price && (
                <div style={{ fontWeight: 600, color: '#f97316' }}>
                  {item.quantity > 1 && (
                    <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 4 }}>
                      ¥{item.price}×{item.quantity}
                    </span>
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
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddDiningModal onClose={() => setShowAdd(false)} onSaved={fetchRecords} />}
    </div>
  )
}