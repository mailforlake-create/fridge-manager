import { FOOD_CATEGORIES, DAILY_CATEGORIES, UNITS, DAILY_UNITS, isDailyCategory } from './categories'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export async function callAI(messages, aiConfig = {}) {
  // 找到当前选中的模型 URL
  const models = aiConfig.ai_models || []
  const selectedName = aiConfig.ai_selected_model || ''
  const selectedModel = models.find(m => m.name === selectedName) || models[0]
  const modelUrl = selectedModel?.url || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent'

  const res = await fetch(`${SUPABASE_URL}/functions/v1/claude-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      model_url: modelUrl,
      max_tokens: Number(aiConfig.ai_max_tokens) || 4096,
      messages
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || `AI请求失败（HTTP ${res.status}）`)
  if (data.error) throw new Error(data.error)

  const text = data?.content?.[0]?.text || ''
  if (text) return text

  const finishReason = data?.raw?.candidates?.[0]?.finishReason
  const blockReason = data?.raw?.promptFeedback?.blockReason
  const details = [finishReason ? `finishReason=${finishReason}` : '', blockReason ? `blockReason=${blockReason}` : '']
    .filter(Boolean)
    .join(', ')
  throw new Error(`AI返回为空，请检查模型配置或稍后重试${details ? `（${details}）` : ''}`)
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function parseIngredients(text) {
  try {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (match) return JSON.parse(match[0])
  } catch (e) { console.error('解析失败：', e) }
  return []
}

export function calcExpiry(mfgDate, shelfDays) {
  if (!mfgDate || !shelfDays) return ''
  const d = new Date(mfgDate)
  d.setDate(d.getDate() + Number(shelfDays))
  return d.toISOString().split('T')[0]
}

export async function recognizePhoto(file) {
  const foodCats = (categories.food_categories || FOOD_CATEGORIES).join('/')
  const foodUnits = (categories.food_units || UNITS).join('/')
  const base64 = await fileToBase64(file)
  const prompt = `你是食材识别助手。识别图片中所有食材，输出JSON数组，每项包含：
name_zh(中文名), name_original(原文，可空), category(${foodCats}),
quantity(数字), unit(${foodUnits}), expiry_date(YYYY-MM-DD或空字符串)
只输出JSON数组。`
  const text = await callAI([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: base64 } },
      { type: 'text', text: prompt }
    ]
  }])
  return parseIngredients(text)
}

export async function recognizeReceipt(file, categories = {}) {
  if (!file) throw new Error('未选择小票图片文件')
  const foodCats = (categories.food_categories || FOOD_CATEGORIES).join('/')
  const dailyCats = (categories.daily_categories || DAILY_CATEGORIES).join('/')
  const foodUnits = (categories.food_units || UNITS).join('/')
  const dailyUnits = (categories.daily_units || DAILY_UNITS).join('/')
  const allUnits = [...new Set([
    ...(categories.food_units || UNITS),
    ...(categories.daily_units || DAILY_UNITS)
  ])].join('/')
  const base64 = await fileToBase64(file)
  const mediaType = file.type || 'image/jpeg'

  const step1Text = await callAI([{
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
重要规则：折扣行（割引/値引等）不要单独列出，合并到上一行商品的discount_info，设is_discount=true。
只输出JSON。` }
    ]
  }])

  let step1
  try {
    const c1 = step1Text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    step1 = JSON.parse(c1)
  } catch {
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

  if (!step1?.items?.length) {
    const preview = (step1Text || '').slice(0, 280).replace(/\s+/g, ' ')
    const meta = {
      has_store_name: Boolean(step1?.store_name),
      has_date: Boolean(step1?.purchased_at),
      has_total: step1?.total_amount !== null && step1?.total_amount !== undefined,
      items_count: step1?.items?.length || 0
    }
    throw new Error(`小票识别未提取到商品明细。解析结果：${JSON.stringify(meta)}。模型返回片段：${preview || '空返回'}`)
  }

  const names = step1.items.map(i => i.name_original).join('\n')
  const step2Text = await callAI([{
    role: 'user',
    content: `将以下日文/英文商品名翻译成中文并分类，输出JSON数组，每项包含：
{"name_original":"原文","name_zh":"中文名","category":"${foodCats}/${dailyCats}/其他","unit":"${allUnits}"}
商品列表：
${names}
只输出JSON数组。`
  }])

  let translations = []
  try {
    const c2 = step2Text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const match = c2.match(/\[[\s\S]*\]/)
    if (match) translations = JSON.parse(match[0])
  } catch (e) { console.error('翻译解析失败', e) }

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
      shelf_days: '',
      memo: ''
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
