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
      { type: 'text', text: `你是专业的购物小票识别助手。请仔细识别这张小票上的【所有商品】，不要遗漏任何一件。

输出JSON格式：
{
  "store_name": "商家中文名",
  "store_name_original": "商家原文名",
  "purchased_at": "YYYY-MM-DD或空字符串",
  "total_amount": 合计金额数字或null,
  "items": [
    {
      "name_original": "商品原文名称（完整保留）",
      "price": 实付单价数字或null,
      "original_price": 原价数字或null,
      "is_discount": true或false,
      "discount_info": "折扣说明或空字符串",
      "quantity": 数量数字
    }
  ]
}

重要规则：
1. 必须列出小票上【每一件】商品，不能只返回部分
2. 折扣行（割引/値引/セール等）不单独列出，合并到上一行商品的discount_info字段
3. 小计行、合计行、税额行不作为商品列出
4. 如果看不清某件商品名称，用可识别的部分代替，不要忽略该商品
5. 只输出JSON，不要任何说明文字` }
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

  if (!step1?.items?.length) return null

  const names = step1.items.map(i => i.name_original).join('\n')
  const step2Text = await callAI([{
    role: 'user',
    content: `你是专业的商品名称翻译助手。将以下【全部】日文/英文商品名翻译成中文并分类。

必须对每一个商品名进行翻译，输入几个就输出几个，数量必须完全一致。

输出JSON数组，每项包含：
{"name_original":"原文（原样保留）","name_zh":"中文名","category":"${foodCats}/${dailyCats}/其他","unit":"${allUnits}"}

商品列表（共${step1.items.length}件，必须全部翻译）：
${names}

只输出JSON数组，不要任何说明文字。`
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