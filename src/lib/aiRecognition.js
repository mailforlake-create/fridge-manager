import { FOOD_CATEGORIES, DAILY_CATEGORIES, UNITS, DAILY_UNITS } from './categories'
import { parseReceiptItemJSON, normalizeReceiptItem } from './receiptItem'
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
      max_tokens: Number(aiConfig.ai_max_tokens) || 100000,
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

export async function recognizePhoto(file, categories = {}) {
  const foodCats = (categories.food_categories?.length ? categories.food_categories : FOOD_CATEGORIES).join('/')
  const foodUnits = (categories.food_units?.length ? categories.food_units : UNITS).join('/')
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

// 识别可用的分类 / 单位列表，优先使用设置里的自定义配置
function buildReceiptCategoryLists(categories = {}) {
  const foodCats = categories.food_categories?.length ? categories.food_categories : FOOD_CATEGORIES
  const dailyCats = categories.daily_categories?.length ? categories.daily_categories : DAILY_CATEGORIES
  const units = [...new Set([
    ...(categories.food_units?.length ? categories.food_units : UNITS),
    ...(categories.daily_units?.length ? categories.daily_units : DAILY_UNITS)
  ])]
  return { foodCats, dailyCats, units }
}

// 单件商品拍照识别：识别一张商品包装 / 标签 / 价签照片，返回与小票 item 相同结构的一条商品
export async function recognizeReceiptItem(file, settings = {}) {
  if (!file) return null
  const base64 = await fileToBase64(file)
  const mediaType = file.type || 'image/jpeg'
  const { foodCats, dailyCats, units } = buildReceiptCategoryLists(settings)
  const foodCatText = foodCats.join('/')
  const dailyCatText = dailyCats.join('/')
  const unitText = units.join('/')

  const prompt = `你是商品信息识别助手。识别图片中【最主要的一件商品】（商品包装、背标、价签或单件商品照片均可），输出JSON对象，只输出JSON不要说明：
{
  "name_zh": "中文名",
  "name_original": "原文完整保留",
  "category": "${foodCatText}/${dailyCatText}/非食材/其他",
  "quantity": 购买件数,
  "unit": "${unitText}",
  "price": 实付总价或null,
  "original_price": 原价总价或null,
  "is_discount": false,
  "discount_info": ""
}

规则：
1. 只识别图片中占主导的那一件商品，忽略背景里的其他商品
2. name_zh 用中文常用名称；name_original 保留包装上的原文（日文/英文等），没有则空字符串
3. category 必须从给定分类中选择：食用品（${foodCatText}）、非食用品（${dailyCatText}）；无法归类填"其他"；完全不是食材/日用品填"非食材"
4. unit 必须从给定单位中选择：${unitText}；无法判断填"个"
5. quantity 是购买件数，默认 1；包装上的"2個入"等规格不算购买件数
6. 价格规则（重要）：
   - 图片中有价签/小票行/折扣贴纸时：price=实付总价（含税、已扣折扣），original_price=折扣前原价
   - 有折扣（割引/値引/セール/○○円引/ポイント等）时 is_discount=true，discount_info 写折扣内容，如"割引-100円"
   - 没有折扣时 is_discount=false，discount_info=""
   - 完全看不到价格时 price=null、original_price=null
7. 价格一律填总价，不是单价`

  const text = await callAI([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: prompt }
    ]
  }], { ...settings, ai_max_tokens: Number(settings.ai_max_tokens) || 4096 })

  const item = normalizeReceiptItem(parseReceiptItemJSON(text))
  return item?.name_zh ? item : null
}

export async function recognizeReceipt(file, categories = {}) {
  const base64 = await fileToBase64(file)
  const mediaType = file.type || 'image/jpeg'
  const { foodCats, dailyCats, units } = buildReceiptCategoryLists(categories)
  const foodCatText = foodCats.join('/')
  const dailyCatText = dailyCats.join('/')
  const allUnits = units.join('/')

  const prompt = `识别这张购物小票，输出JSON，只输出JSON不要说明：
{
  "store_name": "店名中文",
  "store_name_original": "店名原文", 
  "purchased_at": "YYYY-MM-DD或空",
  "total_amount": 合计金额数字或null,
  "total_item_count": 小票上显示的总件数数字,
  "items": [{"name_zh":"中文名","name_original":"原文完整保留","category":"${foodCatText}/${dailyCatText}/其他","quantity":购买件数,"unit":"${allUnits}","price":实付总价或null,"original_price":原价总价或null,"is_discount":false,"discount_info":""}]
}

规则：
1. 先找小票上的总件数（点数/品数/合計点数等），填入total_item_count
2. items中所有quantity之和必须等于total_item_count，不等说明有遗漏必须补全
3. 逐行扫描小票，每一行商品都要列入items，绝不跳过
4. 数量规则：如"158×2=316"，quantity=2，price=316
5. 折扣价格规则（重要）：
   - 当某行商品下方紧跟着折扣行（割引/値引/セール/ポイント等，通常为负数金额）时
   - 该商品的 original_price = 商品行显示的价格（原价）
   - 该商品的 price = 商品行价格 + 折扣行价格（折扣为负数，相加得实付价）
   - 例如：商品498円，下行「割引 -100円」，则 original_price=498，price=398，is_discount=true，discount_info="割引-100円"
   - 折扣行本身不单独列入items
6. 括号说明行规则（重要）：
   - 折扣行下方如有括号开头的说明行，如「（5点 1回 - 210）」「（会員割引）」等
   - 这类括号行只是对上一行折扣的补充说明，直接跳过，不做任何处理
   - 不影响价格计算，不列入items，不修改discount_info
7. 合计/小計/税額/お釣り等非商品行不列入items`

 const text = await callAI([{
  role: 'user',
  content: [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
    { type: 'text', text: prompt }
  ]
}], { ...categories, ai_max_tokens: 100000 })  // ← 小票识别用更大的 token 限制

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
            } catch {
              // 单个 item 片段被截断时跳过，继续解析后续片段
            }
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
  if (result?.items?.length) {
  const totalQty = result.items.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0)
  if (result.total_item_count && totalQty < result.total_item_count) {
    console.warn(`识别不完整：小票总件数${result.total_item_count}，实际识别${totalQty}件`)
  }
}

  const items = result.items.map(normalizeReceiptItem).filter(Boolean)
  if (!items.length) return null

  return {
    store_name: result.store_name || '未知商家',
    store_name_original: result.store_name_original || '',
    purchased_at: result.purchased_at || '',
    total_amount: result.total_amount || null,
    items
  }
}