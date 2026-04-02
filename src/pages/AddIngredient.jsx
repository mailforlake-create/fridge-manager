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
body: JSON.stringify({
  max_tokens: 4096,  // ← 从 1024 改成 4096
  messages
})
  })
  const data = await res.json()
  console.log('Claude 返回：', JSON.stringify(data))  // ← 加这行
  if (data.error) throw new Error(data.error)
  return data.content[0].text
}
// 图片文件 → base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ─── 解析 Claude 返回的 JSON ──────────────────────────────
function parseIngredients(text) {
  try {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (match) {
      const result = JSON.parse(match[0])
      console.log('解析结果：', result)  // ← 加这行
      return result
    }
  } catch (e) {
    console.error('解析失败：', e)
  }
  return []
}

// ─── 单食材/多食材拍照识别 ────────────────────────────────
async function recognizePhoto(file) {
  const base64 = await fileToBase64(file)
  const mediaType = file.type || 'image/jpeg'
  const prompt = `你是一个冰箱食材识别助手。请识别图片中的所有食材。

对每种食材输出 JSON 数组，每项包含：
- name_zh: 中文名称
- name_original: 原文名称（如果可识别日文/英文商品名，否则留空字符串）
- category: 分类（蔬菜/水果/肉类/海鲜/乳制品/饮料/调味料/冷冻食品/其他）
- quantity: 数量（数字，无法判断填1）
- unit: 单位（个/包/瓶/袋/克/毫升/升/根/片/块）
- expiry_date: 过期日期（如果图片中可见，格式 YYYY-MM-DD，否则留空字符串）

只输出 JSON 数组，不要其他文字。例：
[{"name_zh":"牛奶","name_original":"牛乳","category":"乳制品","quantity":1,"unit":"瓶","expiry_date":"2025-04-10"}]`

  const text = await callClaude([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: prompt }
    ]
  }])
  return parseIngredients(text)
}

// ─── 购物小票识别 ─────────────────────────────────────────
async function recognizeReceipt(file) {
  const base64 = await fileToBase64(file)
  const mediaType = file.type || 'image/jpeg'
  const prompt = `你是一个购物小票识别助手。请从这张购物小票（可能是日文或英文）中提取所有食材类商品。

非食材类商品（如袋子、积分、折扣行）请忽略。

对每种食材输出 JSON 数组，每项包含：
- name_zh: 中文名称（将日文/英文翻译成中文）
- name_original: 原文名称（小票上的原始文字）
- category: 分类（蔬菜/水果/肉类/海鲜/乳制品/饮料/调味料/冷冻食品/其他）
- quantity: 数量（从小票读取，无法判断填1）
- unit: 单位（个/包/瓶/袋/克/毫升/升/根/片/块）
- expiry_date: 留空字符串

只输出 JSON 数组，不要其他文字。`

  const text = await callClaude([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: prompt }
    ]
  }])
  return parseIngredients(text)
}

// ─── 主组件 ───────────────────────────────────────────────
const TABS = [
  { id: 'manual',  label: '手动', icon: '✏️' },
  { id: 'photo',   label: '拍照', icon: '📷' },
  { id: 'receipt', label: '小票', icon: '🧾' },
  { id: 'barcode', label: '条形码', icon: '📦' },
]

const EMPTY_FORM = {
  name_zh: '', name_original: '', category: '',
  quantity: '', unit: '个', expiry_date: '', location: 'fridge'
}

export default function AddIngredient() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('manual')
  const [form, setForm] = useState(EMPTY_FORM)
  const [aiItems, setAiItems] = useState([])   // AI 识别出的候选列表
  const [selected, setSelected] = useState({}) // 勾选状态
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const photoRef = useRef()
  const receiptRef = useRef()

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // ── 拍照/小票上传后识别 ──────────────────────────────────
  async function handleImage(file, type) {
    if (!file) return
    setLoading(true)
    setAiItems([])
    setSelected({})
    try {
      const items = type === 'receipt'
        ? await recognizeReceipt(file)
        : await recognizePhoto(file)
      setAiItems(items)
      // 默认全选
      const sel = {}
      items.forEach((_, i) => { sel[i] = true })
      setSelected(sel)
    } catch (e) {
      alert('识别失败，请重试：' + e.message)
    }
    setLoading(false)
  }

  // ── 保存选中的 AI 识别结果 ────────────────────────────────
  async function saveAiItems() {
    const toSave = aiItems
      .filter((_, i) => selected[i])
      .map(item => ({
        name_zh: item.name_zh,
        name_original: item.name_original || null,
        category: item.category || null,
        quantity: item.quantity || null,
        unit: item.unit || '个',
        expiry_date: item.expiry_date || null,
        location: 'fridge'
      }))
    if (!toSave.length) return alert('请至少选择一项')
    setSaving(true)
    await supabase.from('ingredients').insert(toSave)
    setSaving(false)
    navigate('/fridge')
  }

  // ── 手动保存 ────────────────────────────────────────────
  async function saveManual() {
    if (!form.name_zh.trim()) return alert('请输入食材名称')
    setSaving(true)
    await supabase.from('ingredients').insert({
      ...form,
      quantity: form.quantity ? Number(form.quantity) : null
    })
    setSaving(false)
    navigate('/fridge')
  }

  // ── 条形码（Open Food Facts） ────────────────────────────
  async function lookupBarcode(code) {
    setLoading(true)
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`)
      const data = await res.json()
      if (data.status === 1) {
        const p = data.product
        const nameEn = p.product_name_en || p.product_name || ''
        const nameJa = p.product_name_ja || ''
        const original = nameJa || nameEn
        // 用 Claude 翻译成中文
        const zh = await callClaude([{
          role: 'user',
          content: `将以下食品名称翻译成中文，只输出中文名称，不要其他内容：${original || nameEn}`
        }])
        setForm(f => ({
          ...f,
          name_zh: zh.trim(),
          name_original: original,
          category: '其他'
        }))
        setTab('manual')
      } else {
        alert('未找到该条形码对应的商品，请手动输入')
        setTab('manual')
      }
    } catch {
      alert('查询失败，请检查网络')
    }
    setLoading(false)
  }

  // ── 样式常量 ────────────────────────────────────────────
  const field = {
    width: '100%', padding: '11px 14px', borderRadius: 10, fontSize: 15,
    border: '1.5px solid #e2e8f0', outline: 'none', marginTop: 6, background: '#fff'
  }
  const labelSt = { fontSize: 13, fontWeight: 600, color: '#475569' }

  // ── 上传区域（拍照/小票共用） ─────────────────────────────
  function UploadZone({ refEl, type }) {
    return (
      <div>
        <input ref={refEl} type="file" accept="image/*"
          capture={type === 'photo' ? 'environment' : undefined}
          style={{ display: 'none' }}
          onChange={e => handleImage(e.target.files[0], type)} />
        <button onClick={() => refEl.current.click()} style={{
          width: '100%', padding: '40px 0', borderRadius: 14,
          border: '2px dashed #cbd5e1', background: '#f8fafc',
          color: '#64748b', fontSize: 15, display: 'flex',
          flexDirection: 'column', alignItems: 'center', gap: 8
        }}>
          <span style={{ fontSize: 40 }}>{type === 'photo' ? '📷' : '🧾'}</span>
          <span style={{ fontWeight: 600 }}>
            {type === 'photo' ? '拍摄或选择食材照片' : '拍摄或选择购物小票'}
          </span>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            {type === 'photo' ? '支持单个或多个食材' : '支持日文、英文小票'}
          </span>
        </button>
      </div>
    )
  }

  // ── AI 识别结果列表 ───────────────────────────────────────
  function AiResultList() {
    if (!aiItems.length) return null
    return (
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#475569', marginBottom: 10 }}>
          识别到 {aiItems.length} 种食材，请确认：
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {aiItems.map((item, i) => (
            <div key={i} onClick={() => setSelected(s => ({ ...s, [i]: !s[i] }))}
              style={{
                background: selected[i] ? '#f0fdf4' : '#f8fafc',
                border: `1.5px solid ${selected[i] ? '#16a34a' : '#e2e8f0'}`,
                borderRadius: 12, padding: '12px 14px',
                display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer'
              }}>
              <div style={{
                width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                border: `2px solid ${selected[i] ? '#16a34a' : '#cbd5e1'}`,
                background: selected[i] ? '#16a34a' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                {selected[i] && <span style={{ color: '#fff', fontSize: 13, lineHeight: 1 }}>✓</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{item.name_zh}</div>
                {item.name_original && (
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{item.name_original}</div>
                )}
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  {item.quantity}{item.unit} · {item.category}
                  {item.expiry_date && ` · 到期 ${item.expiry_date}`}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={() => { setAiItems([]); setSelected({}) }}
            style={{
              flex: 1, padding: '12px 0', borderRadius: 12,
              background: '#f1f5f9', color: '#475569', fontSize: 15, fontWeight: 600
            }}>重新识别</button>
          <button onClick={saveAiItems} disabled={saving} style={{
            flex: 2, padding: '12px 0', borderRadius: 12,
            background: '#16a34a', color: '#fff', fontSize: 15, fontWeight: 700
          }}>{saving ? '保存中...' : `保存选中项`}</button>
        </div>
      </div>
    )
  }

  // ── 条形码输入 ───────────────────────────────────────────
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
          placeholder="例：4902102141734"
          style={{ ...field, marginTop: 0 }}
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

      {/* Tab 切换 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 6, marginBottom: 20,
        background: '#f1f5f9', borderRadius: 12, padding: 4
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setAiItems([]); setSelected({}) }}
            style={{
              padding: '8px 0', borderRadius: 9, fontSize: 12, fontWeight: 600,
              background: tab === t.id ? '#fff' : 'transparent',
              color: tab === t.id ? '#16a34a' : '#94a3b8',
              boxShadow: tab === t.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
            }}>
            <span style={{ fontSize: 18 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* 加载状态 */}
      {loading && (
        <div style={{
          textAlign: 'center', padding: '40px 0',
          color: '#16a34a', fontSize: 15
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✨</div>
          AI 识别中，请稍候...
        </div>
      )}

      {/* Tab 内容 */}
      {!loading && (
        <>
          {/* 手动 */}
          {tab === 'manual' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={labelSt}>食材名称（中文）*</div>
                <input style={field} value={form.name_zh}
                  onChange={e => set('name_zh', e.target.value)} placeholder="例：牛奶" />
              </div>
              <div>
                <div style={labelSt}>原文名称（日文/英文）</div>
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
                    {['个','包','瓶','袋','克','毫升','升','根','片','块'].map(u =>
                      <option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div style={labelSt}>分类</div>
                <select style={field} value={form.category} onChange={e => set('category', e.target.value)}>
                  <option value="">选择分类</option>
                  {['蔬菜','水果','肉类','海鲜','乳制品','饮料','调味料','冷冻食品','其他'].map(c =>
                    <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <div style={labelSt}>过期日期</div>
                <input style={field} type="date" value={form.expiry_date}
                  onChange={e => set('expiry_date', e.target.value)} />
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
              <button onClick={saveManual} disabled={saving} style={{
                padding: '14px 0', borderRadius: 12, background: '#16a34a',
                color: '#fff', fontSize: 16, fontWeight: 700, marginTop: 8
              }}>{saving ? '保存中...' : '保存食材'}</button>
            </div>
          )}

          {/* 拍照 */}
          {tab === 'photo' && (
            <div>
              {!aiItems.length && <UploadZone refEl={photoRef} type="photo" />}
              <AiResultList />
            </div>
          )}

          {/* 小票 */}
          {tab === 'receipt' && (
            <div>
              {!aiItems.length && <UploadZone refEl={receiptRef} type="receipt" />}
              <AiResultList />
            </div>
          )}

          {/* 条形码 */}
          {tab === 'barcode' && <BarcodeTab />}
        </>
      )}
    </div>
  )
}