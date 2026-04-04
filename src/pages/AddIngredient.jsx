import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function callClaude(messages) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/claude-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ max_tokens: 4096, messages })
  })
  const data = await res.json()
  console.log('Claude 返回：', JSON.stringify(data))
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

function parseIngredients(text) {
  try {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (match) {
      const result = JSON.parse(match[0])
      console.log('解析结果：', result)
      return result
    }
  } catch (e) {
    console.error('解析失败：', e)
  }
  return []
}

function calcExpiry(mfgDate, shelfDays) {
  if (!mfgDate || !shelfDays) return ''
  const d = new Date(mfgDate)
  d.setDate(d.getDate() + Number(shelfDays))
  return d.toISOString().split('T')[0]
}

async function recognizePhoto(file) {
  const base64 = await fileToBase64(file)
  const prompt = `你是冰箱食材识别助手。识别图片中所有食材，输出JSON数组，每项包含：
name_zh(中文名), name_original(原文，可空), category(蔬菜/水果/肉类/海鲜/乳制品/饮料/调味料/冷冻食品/其他),
quantity(数字), unit(个/包/瓶/袋/克/毫升/升/根/片/块), expiry_date(YYYY-MM-DD或空字符串)
只输出JSON数组。`
  const text = await callClaude([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: base64 } },
      { type: 'text', text: prompt }
    ]
  }])
  return parseIngredients(text)
}

async function recognizeReceipt(file) {
  const base64 = await fileToBase64(file)
  const mediaType = file.type || 'image/jpeg'

  // 第一步：只识别商家信息 + 商品名称列表
  const step1Text = await callClaude([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: `从这张购物小票提取以下信息，输出JSON：
{
  "store_name": "商家中文名",
  "store_name_original": "商家原文",
  "purchased_at": "YYYY-MM-DD或空字符串",
  "total_amount": 合计数字或null,
  "items": [
    {"name_original": "原文商品名", "price": 价格数字或null, "original_price": 原价或null, "is_discount": true/false, "discount_info": "折扣说明或空字符串", "quantity": 数量数字}
  ]
}
只输出JSON。` }
    ]
  }])

  let step1
  try {
    const c1 = step1Text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    step1 = JSON.parse(c1)
  } catch {
    // 截断时容错
    const storeMatch = step1Text.match(/"store_name"\s*:\s*"([^"]*)"/)
    const storeOrigMatch = step1Text.match(/"store_name_original"\s*:\s*"([^"]*)"/)
    const dateMatch = step1Text.match(/"purchased_at"\s*:\s*"([^"]*)"/)
    const totalMatch = step1Text.match(/"total_amount"\s*:\s*(\d+)/)
    const itemRegex = /\{\s*"name_original"\s*:[^}]+\}/g
    const items = []
    let m
    while ((m = itemRegex.exec(step1Text)) !== null) {
      try { items.push(JSON.parse(m[0])) } catch {}
    }
    step1 = {
      store_name: storeMatch?.[1] || '未知商家',
      store_name_original: storeOrigMatch?.[1] || '',
      purchased_at: dateMatch?.[1] || '',
      total_amount: totalMatch ? Number(totalMatch[1]) : null,
      items
    }
  }

  if (!step1?.items?.length) return null

  // 第二步：把原文商品名批量翻译+分类
  const names = step1.items.map(i => i.name_original).join('\n')
  const step2Text = await callClaude([{
    role: 'user',
    content: `将以下日文/英文商品名翻译成中文并分类，输出JSON数组，每项包含：
{"name_original": "原文", "name_zh": "中文名", "category": "蔬菜/水果/肉类/海鲜/乳制品/饮料/调味料/冷冻食品/零食/其他/非食材", "unit": "个/包/瓶/袋/克/毫升/升/根/片/块"}
商品列表：
${names}
只输出JSON数组。`
  }])

  let translations = []
  try {
    const c2 = step2Text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const match = c2.match(/\[[\s\S]*\]/)
    if (match) translations = JSON.parse(match[0])
  } catch (e) {
    console.error('翻译解析失败', e)
  }

  // 合并两步结果
  const items = step1.items.map((item, i) => {
    const trans = translations[i] || {}
    return {
      name_zh: trans.name_zh || item.name_original,
      name_original: item.name_original,
      category: trans.category || '其他',
      quantity: item.quantity || 1,
      unit: trans.unit || '个',
      price: item.price || null,
      original_price: item.original_price || null,
      is_discount: item.is_discount || false,
      discount_info: item.discount_info || '',
      expiry_date: '',
      mfg_date: '',
      shelf_days: ''
    }
  })

  return {
    store_name: step1.store_name,
    store_name_original: step1.store_name_original,
    purchased_at: step1.purchased_at,
    total_amount: step1.total_amount,
    items
  }
}

const TABS = [
  { id: 'manual', label: '手动', icon: '✏️' },
  { id: 'photo', label: '拍照', icon: '📷' },
  { id: 'receipt', label: '小票', icon: '🧾' },
  { id: 'barcode', label: '条形码', icon: '📦' },
]

const EMPTY_FORM = {
  name_zh: '', name_original: '', category: '',
  quantity: '', unit: '个', expiry_date: '',
  mfg_date: '', shelf_days: '', location: 'fridge', memo: ''
}

const UNITS = ['个','包','瓶','袋','克','毫升','升','根','片','块']
const CATEGORIES = ['蔬菜','水果','肉类','海鲜','乳制品','饮料','调味料','冷冻食品','其他']

export default function AddIngredient() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('receipt')
  const [form, setForm] = useState(EMPTY_FORM)
  const [aiItems, setAiItems] = useState([])
  const [selected, setSelected] = useState({})
  const [receiptData, setReceiptData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => {
    const next = { ...f, [k]: v }
    if (k === 'mfg_date' || k === 'shelf_days') {
      next.expiry_date = calcExpiry(
        k === 'mfg_date' ? v : f.mfg_date,
        k === 'shelf_days' ? v : f.shelf_days
      )
    }
    return next
  })

  function setItemField(i, k, v) {
    setAiItems(items => {
      const next = [...items]
      next[i] = { ...next[i], [k]: v }
      if (k === 'mfg_date' || k === 'shelf_days') {
        next[i].expiry_date = calcExpiry(
          k === 'mfg_date' ? v : next[i].mfg_date,
          k === 'shelf_days' ? v : next[i].shelf_days
        )
      }
      return next
    })
  }

  async function handleImage(file, type) {
    if (!file) return
    setLoading(true)
    setAiItems([])
    setSelected({})
    setReceiptData(null)
    try {
      if (type === 'receipt') {
        const data = await recognizeReceipt(file)
        if (data && data.items) {
          setReceiptData(data)
          const items = data.items.map(i => ({ ...i, mfg_date: '', shelf_days: '' }))
          setAiItems(items)
          const sel = {}
          items.forEach((item, i) => { sel[i] = item.category !== '非食材' })
          setSelected(sel)
        } else {
          alert('小票识别失败，请重试')
        }
      } else {
        const items = await recognizePhoto(file)
        const itemsWithExtra = items.map(i => ({ ...i, mfg_date: '', shelf_days: '' }))
        setAiItems(itemsWithExtra)
        const sel = {}
        itemsWithExtra.forEach((_, i) => { sel[i] = true })
        setSelected(sel)
      }
    } catch (e) {
      alert('识别失败，请重试：' + e.message)
    }
    setLoading(false)
  }

  async function mergeOrInsert(item) {
    // 查找同名食材
    const { data: existing } = await supabase
      .from('ingredients')
      .select('id, quantity')
      .eq('name_zh', item.name_zh)
      .maybeSingle()
    if (existing) {
      await supabase.from('ingredients')
        .update({ quantity: (existing.quantity || 0) + (item.quantity || 1) })
        .eq('id', existing.id)
    } else {
      await supabase.from('ingredients').insert(item)
    }
  }

  async function saveAiItems() {
    const toSave = aiItems.filter((_, i) => selected[i])
    if (!toSave.length) return alert('请至少选择一项')
    setSaving(true)

    // 保存购物履历
    if (receiptData) {
      const { data: history } = await supabase
        .from('purchase_history')
        .insert({
          store_name: receiptData.store_name || '未知商家',
          purchased_at: receiptData.purchased_at || null,
          total_amount: receiptData.total_amount || null
        })
        .select().single()

      if (history) {
        const historyItems = aiItems.map((item, i) => ({
          history_id: history.id,
          name_zh: item.name_zh,
          name_original: item.name_original || null,
          category: item.category || null,
          quantity: Number(item.quantity) || 1,
          unit: item.unit || '个',
          price: item.price || null,
          original_price: item.original_price || null,
          is_discount: item.is_discount || false,
          discount_info: item.discount_info || null,
          add_to_fridge: selected[i] && item.category !== '非食材',
          expiry_date: item.expiry_date || null
        }))
        await supabase.from('purchase_items').insert(historyItems)
      }
    }

    // 存入冰箱（同名合并）
    const fridgeItems = toSave
      .filter(i => i.category !== '非食材')
      .map(item => ({
        name_zh: item.name_zh,
        name_original: item.name_original || null,
        category: item.category || null,
        quantity: Number(item.quantity) || 1,
        unit: item.unit || '个',
        expiry_date: item.expiry_date || null,
        location: 'fridge'
      }))

    for (const item of fridgeItems) {
      await mergeOrInsert(item)
    }

    setSaving(false)
    navigate('/fridge')
  }

  async function saveManual() {
    if (!form.name_zh.trim()) return alert('请输入食材名称')
    setSaving(true)
    const item = {
      name_zh: form.name_zh,
      name_original: form.name_original || null,
      category: form.category || null,
      quantity: form.quantity ? Number(form.quantity) : 1,
      unit: form.unit,
      expiry_date: form.expiry_date || null,
      location: form.location,
      memo: form.memo || null
    }
    await mergeOrInsert(item)
    setSaving(false)
    navigate('/fridge')
  }

  async function lookupBarcode(code) {
    setLoading(true)
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`)
      const data = await res.json()
      if (data.status === 1) {
        const p = data.product
        const original = p.product_name_ja || p.product_name_en || p.product_name || ''
        const zh = await callClaude([{
          role: 'user',
          content: `将以下食品名称翻译成中文，只输出中文名称：${original}`
        }])
        setForm(f => ({ ...f, name_zh: zh.trim(), name_original: original, category: '其他' }))
        setTab('manual')
      } else {
        alert('未找到该条形码，请手动输入')
        setTab('manual')
      }
    } catch { alert('查询失败') }
    setLoading(false)
  }

  const field = {
    width: '100%', padding: '11px 14px', borderRadius: 10, fontSize: 15,
    border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
  }
  const smallField = {
    width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13,
    border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
  }
  const labelSt = { fontSize: 13, fontWeight: 600, color: '#475569' }

  // 生产日期+保质期输入组件（手动和AI列表共用）
  function ExpirySection({ mfgDate, shelfDays, expiryDate, onMfg, onShelf, onExpiry, small }) {
    const f = small ? smallField : field
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: small ? 4 : 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: small ? 11 : 13, color: '#94a3b8', marginBottom: 2 }}>生产日期</div>
            <input style={f} type="date" value={mfgDate} onChange={e => onMfg(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: small ? 11 : 13, color: '#94a3b8', marginBottom: 2 }}>保质期(天)</div>
            <input style={f} type="number" placeholder="如：180" value={shelfDays}
              onChange={e => onShelf(e.target.value)} />
          </div>
        </div>
        <div>
          <div style={{ fontSize: small ? 11 : 13, color: '#94a3b8', marginBottom: 2 }}>过期日期</div>
          <input style={f} type="date" value={expiryDate} onChange={e => onExpiry(e.target.value)} />
        </div>
      </div>
    )
  }

  // AI识别结果列表（拍照/小票共用）
  function AiResultList() {
    if (!aiItems.length) return null
    return (
      <div style={{ marginTop: 16 }}>
        {receiptData && (
          <div style={{
            background: '#f0fdf4', borderRadius: 10, padding: '10px 14px',
            marginBottom: 12, fontSize: 13
          }}>
            <div style={{ fontWeight: 600, color: '#16a34a' }}>
              {receiptData.store_name || '未知商家'}
            </div>
            <div style={{ color: '#64748b', marginTop: 2 }}>
              {receiptData.purchased_at && `购买日期：${receiptData.purchased_at}　`}
              {receiptData.total_amount && `合计：¥${receiptData.total_amount}`}
            </div>
          </div>
        )}
        <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 8 }}>
          识别到 {aiItems.length} 件商品，勾选存入冰箱：
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {aiItems.map((item, i) => (
            <div key={i} style={{
              background: selected[i] ? '#f0fdf4' : '#f8fafc',
              border: `1.5px solid ${selected[i] ? '#16a34a' : '#e2e8f0'}`,
              borderRadius: 12, padding: '10px 12px'
            }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div onClick={() => setSelected(s => ({ ...s, [i]: !s[i] }))}
                  style={{
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
                    <input style={{ ...smallField, flex: 1 }} type="number" value={item.quantity}
                      onChange={e => setItemField(i, 'quantity', e.target.value)} />
                    <select style={{ ...smallField, flex: 1 }} value={item.unit}
                      onChange={e => setItemField(i, 'unit', e.target.value)}>
                      {UNITS.map(u => <option key={u}>{u}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select style={{ ...smallField, flex: 1 }} value={item.category || ''}
                      onChange={e => setItemField(i, 'category', e.target.value)}>
                      <option value="">分类</option>
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                    {receiptData && (
                      <div style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {item.is_discount && <span style={{ color: '#ef4444', fontWeight: 600 }}>折扣</span>}
                        {item.price && <span>¥{item.price}</span>}
                        {item.original_price && item.is_discount && (
                          <span style={{ textDecoration: 'line-through', color: '#94a3b8' }}>¥{item.original_price}</span>
                        )}
                      </div>
                    )}
                  </div>
                  {item.name_original && (
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.name_original}</div>
                  )}
                  {item.discount_info && (
                    <div style={{ fontSize: 11, color: '#ef4444' }}>{item.discount_info}</div>
                  )}
                  <ExpirySection
                    small
                    mfgDate={item.mfg_date || ''}
                    shelfDays={item.shelf_days || ''}
                    expiryDate={item.expiry_date || ''}
                    onMfg={v => setItemField(i, 'mfg_date', v)}
                    onShelf={v => setItemField(i, 'shelf_days', v)}
                    onExpiry={v => setItemField(i, 'expiry_date', v)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={() => { setAiItems([]); setSelected({}); setReceiptData(null) }}
            style={{
              flex: 1, padding: '12px 0', borderRadius: 12,
              background: '#f1f5f9', color: '#475569', fontSize: 14, fontWeight: 600
            }}>重新识别</button>
          <button onClick={saveAiItems} disabled={saving} style={{
            flex: 2, padding: '12px 0', borderRadius: 12,
            background: '#16a34a', color: '#fff', fontSize: 15, fontWeight: 700
          }}>{saving ? '保存中...' : '保存选中项'}</button>
        </div>
      </div>
    )
  }

  function BarcodeTab() {
    const [code, setCode] = useState('')
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{
          padding: '28px 20px', borderRadius: 14,
          border: '2px dashed #cbd5e1', background: '#f8fafc',
          textAlign: 'center', color: '#64748b'
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📦</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>输入条形码数字</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>相机扫描功能即将推出</div>
        </div>
        <input value={code} onChange={e => setCode(e.target.value)}
          placeholder="例：4902102141734" style={{ ...field, marginTop: 0 }}
          onKeyDown={e => e.key === 'Enter' && lookupBarcode(code)} />
        <button onClick={() => lookupBarcode(code)} disabled={!code || loading}
          style={{
            padding: '13px 0', borderRadius: 12, background: '#16a34a',
            color: '#fff', fontSize: 15, fontWeight: 700,
            opacity: !code || loading ? 0.6 : 1
          }}>
          {loading ? '查询中...' : '查询商品'}
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>添加食材</h1>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 6, marginBottom: 20,
        background: '#f1f5f9', borderRadius: 12, padding: 4
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setAiItems([]); setSelected({}); setReceiptData(null) }}
            style={{
              padding: '8px 0', borderRadius: 9, fontSize: 12, fontWeight: 600,
              background: tab === t.id ? '#fff' : 'transparent',
              color: tab === t.id ? '#16a34a' : '#94a3b8',
              boxShadow: tab === t.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
            }}>
            <span style={{ fontSize: 18 }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#16a34a', fontSize: 15 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✨</div>
          AI 识别中，请稍候...
        </div>
      )}

      {!loading && (
        <>
          {tab === 'manual' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={labelSt}>食材名称（中文）*</div>
                <input style={field} value={form.name_zh}
                  onChange={e => set('name_zh', e.target.value)} placeholder="例：牛奶" />
              </div>
              <div>
                <div style={labelSt}>原文名称</div>
                <input style={field} value={form.name_original}
                  onChange={e => set('name_original', e.target.value)} placeholder="例：牛乳" />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={labelSt}>数量</div>
                  <input style={field} type="number" value={form.quantity}
                    onChange={e => set('quantity', e.target.value)} placeholder="1" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={labelSt}>单位</div>
                  <select style={field} value={form.unit} onChange={e => set('unit', e.target.value)}>
                    {UNITS.map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div style={labelSt}>分类</div>
                <select style={field} value={form.category} onChange={e => set('category', e.target.value)}>
                  <option value="">选择分类</option>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <div style={labelSt}>过期日期</div>
                <ExpirySection
                  mfgDate={form.mfg_date} shelfDays={form.shelf_days} expiryDate={form.expiry_date}
                  onMfg={v => set('mfg_date', v)} onShelf={v => set('shelf_days', v)}
                  onExpiry={v => set('expiry_date', v)} />
              </div>
              <div>
                <div style={labelSt}>存放位置</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  {[['fridge','冰箱'],['freezer','冷冻'],['pantry','常温']].map(([v, l]) => (
                    <button key={v} onClick={() => set('location', v)} style={{
                      flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 14,
                      background: form.location === v ? '#16a34a' : '#f1f5f9',
                      color: form.location === v ? '#fff' : '#475569',
                      fontWeight: form.location === v ? 600 : 400
                    }}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <div style={labelSt}>备注</div>
                <input style={field} value={form.memo}
                  onChange={e => set('memo', e.target.value)} placeholder="可选" />
              </div>
              <button onClick={saveManual} disabled={saving} style={{
                padding: '14px 0', borderRadius: 12, background: '#16a34a',
                color: '#fff', fontSize: 16, fontWeight: 700, marginTop: 4
              }}>{saving ? '保存中...' : '保存食材'}</button>
            </div>
          )}

          {tab === 'photo' && (
            <div>
              {!aiItems.length && (
                <div>
                  <input type="file" accept="image/*" capture="environment"
                    style={{ display: 'none' }} id="photo-input"
                    onChange={e => { const f = e.target.files[0]; e.target.value = ''; handleImage(f, 'photo') }} />
                  <button onClick={() => document.getElementById('photo-input').click()} style={{
                    width: '100%', padding: '40px 0', borderRadius: 14,
                    border: '2px dashed #cbd5e1', background: '#f8fafc',
                    color: '#64748b', fontSize: 15, display: 'flex',
                    flexDirection: 'column', alignItems: 'center', gap: 8
                  }}>
                    <span style={{ fontSize: 40 }}>📷</span>
                    <span style={{ fontWeight: 600 }}>拍摄或选择食材照片</span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>支持单个或多个食材</span>
                  </button>
                </div>
              )}
              <AiResultList />
            </div>
          )}

          {tab === 'receipt' && (
            <div>
              {!aiItems.length && (
                <div>
                  <input type="file" accept="image/*" style={{ display: 'none' }} id="receipt-input"
                    onChange={e => { const f = e.target.files[0]; e.target.value = ''; handleImage(f, 'receipt') }} />
                  <button onClick={() => document.getElementById('receipt-input').click()} style={{
                    width: '100%', padding: '40px 0', borderRadius: 14,
                    border: '2px dashed #cbd5e1', background: '#f8fafc',
                    color: '#64748b', fontSize: 15, display: 'flex',
                    flexDirection: 'column', alignItems: 'center', gap: 8
                  }}>
                    <span style={{ fontSize: 40 }}>🧾</span>
                    <span style={{ fontWeight: 600 }}>拍摄或选择购物小票</span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>识别商家、价格、折扣信息</span>
                  </button>
                </div>
              )}
              <AiResultList />
            </div>
          )}

          {tab === 'barcode' && <BarcodeTab />}
        </>
      )}
    </div>
  )
}