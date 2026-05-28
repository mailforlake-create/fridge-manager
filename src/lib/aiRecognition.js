import { FOOD_CATEGORIES, DAILY_CATEGORIES, UNITS, DAILY_UNITS, isDailyCategory } from './categories'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export async function callAI(messages, aiConfig = {}) {
  // 找到当前选中的模型 URL
  const models = aiConfig.ai_models || []
  const selectedName = aiConfig.ai_selected_model || ''
  const selectedModel = models.find(m => m.name === selectedName) || models[0]
  const modelUrl = selectedModel?.url || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

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
  if (data.error) throw new Error(data.error)
  return data.content[0].text
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
  const base64 = await fileToBase64(file)
  const mediaType = file.type || 'image/jpeg'
  const foodCats = (categories.food_categories || FOOD_CATEGORIES).join('/')
  const dailyCats = (categories.daily_categories || DAILY_CATEGORIES).join('/')
  const allUnits = [...new Set([
    ...(categories.food_units || UNITS),
    ...(categories.daily_units || DAILY_UNITS)
  ])].join('/')
  
  const prompt = `你是专业购物小票识别助手。仔细阅读这张小票图片，识别所有商品信息。

输出以下JSON格式（只输出JSON，不要任何说明）：
{
  "store_name": "商家中文名",
  "store_name_original": "商家原文名",
  "purchased_at": "YYYY-MM-DD或空字符串",
  "total_amount": 合计金额数字或null,
  "items": [
    {
      "name_zh": "商品中文名",
      "name_original": "商品原文名（完整保留）",
      "category": "从以下选择：${foodCats}/${dailyCats}/其他",
      "quantity": 数量数字,
      "unit": "从以下选择：${allUnits}",
      "price": 实付单价数字或null,
      "original_price": 原价数字或null,
      "is_discount": true或false,
      "discount_info": "折扣说明或空字符串"
    }
  ]
}

规则：
- items必须包含小票上每一件商品，绝对不能遗漏
- 折扣行合并到上一件商品的discount_info，不单独列出
- 合计/小计/税额行不列入items
- 商品名直接翻译成中文，保留原文在name_original`

 const text = await callAI([{
  role: 'user',
  content: [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
    { type: 'text', text: prompt }
  ]
}], { ...categories, ai_max_tokens: 8192 })  // ← 小票识别用更大的 token 限制

  let result = null
  try {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    // 先尝试完整解析
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        result = JSON.parse(match[0])
      } catch {
        // JSON 被截断，尝试修复：提取 items 数组中已完整的部分
        const itemsMatch = cleaned.match(/"items"\s*:\s*\[[\s\S]*/)
        if (itemsMatch) {
          // 找出所有完整的 {} 对象
          const itemStr = itemsMatch[0]
          const completeItems = []
          const itemRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\}/g
          let m
          while ((m = itemRegex.exec(itemStr)) !== null) {
            try {
              completeItems.push(JSON.parse(m[0]))
            } catch {}
          }
          if (completeItems.length > 0) {
            // 提取头部信息
            const storeMatch = cleaned.match(/"store_name"\s*:\s*"([^"]*)"/)
            const storeOrigMatch = cleaned.match(/"store_name_original"\s*:\s*"([^"]*)"/)
            const dateMatch = cleaned.match(/"purchased_at"\s*:\s*"([^"]*)"/)
            const totalMatch = cleaned.match(/"total_amount"\s*:\s*(\d+)/)
            result = {
              store_name: storeMatch?.[1] || '',
              store_name_original: storeOrigMatch?.[1] || '',
              purchased_at: dateMatch?.[1] || '',
              total_amount: totalMatch ? Number(totalMatch[1]) : null,
              items: completeItems
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('解析失败', e)
  }

  if (!result?.items?.length) return null

  return {
    store_name: result.store_name || '未知商家',
    store_name_original: result.store_name_original || '',
    purchased_at: result.purchased_at || '',
    total_amount: result.total_amount || null,
    items: result.items.map(item => ({
      name_zh: item.name_zh || item.name_original || '',
      name_original: item.name_original || '',
      category: item.category || '其他',
      quantity: item.quantity || 1,
      unit: item.unit || '个',
      price: item.price || null,
      original_price: item.original_price || null,
      is_discount: item.is_discount || false,
      discount_info: item.discount_info || '',
      expiry_date: '',
      memo: ''
    }))
  }
}