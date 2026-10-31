/**
 * 小票 / 商品标签识别的纯函数工具
 * 不依赖 Vite 环境，可直接被 node --test 引入测试
 */

// 解析模型返回的单个商品 JSON（容忍 ```json 代码块、前后说明、误返回数组）
export function parseReceiptItemJSON(text) {
  if (!text || typeof text !== 'string') return null
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  const candidates = []
  const objectMatch = cleaned.match(/\{[\s\S]*\}/)
  if (objectMatch) candidates.push(objectMatch[0])
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrayMatch) candidates.push(arrayMatch[0])

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (Array.isArray(parsed)) return parsed[0] || null
      if (parsed && typeof parsed === 'object') return parsed
    } catch (e) {
      // 候选片段可能因为模型多输出内容而无法解析，继续尝试下一个候选
      console.error('解析失败：', e)
    }
  }
  return null
}

// 归一化单条商品，字段与小票扫描的单条 item 完全一致
export function normalizeReceiptItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const toPrice = value => {
    if (value === '' || value == null) return null
    const num = Number(value)
    return Number.isFinite(num) ? num : null
  }
  const quantity = Number(raw.quantity)
  return {
    name_zh: raw.name_zh || raw.name_original || '',
    name_original: raw.name_original || '',
    category: raw.category || '其他',
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    unit: raw.unit || '个',
    price: toPrice(raw.price),
    original_price: toPrice(raw.original_price),
    is_discount: raw.is_discount === true || raw.is_discount === 'true',
    discount_info: raw.discount_info || '',
    expiry_date: raw.expiry_date || '',
    memo: raw.memo || ''
  }
}

// 把识别结果合并进已填写的商品：AI 读不到的字段不覆盖用户输入
export function mergeRecognizedReceiptItem(current, incoming, { foodCats = [], dailyCats = [], units = [] } = {}) {
  if (!current || !incoming) return current
  const next = { ...current }
  const validCats = [...foodCats, ...dailyCats, '非食材']

  if (incoming.name_zh) next.name_zh = incoming.name_zh
  if (incoming.name_original) next.name_original = incoming.name_original
  if (incoming.quantity != null) next.quantity = incoming.quantity
  if (incoming.unit && (units.length === 0 || units.includes(incoming.unit))) next.unit = incoming.unit
  if (incoming.price != null) next.price = incoming.price
  if (incoming.original_price != null) next.original_price = incoming.original_price
  if (incoming.is_discount) {
    next.is_discount = true
    if (incoming.discount_info) next.discount_info = incoming.discount_info
  }

  if (incoming.category) {
    if (validCats.includes(incoming.category)) next.category = incoming.category
    else if (!validCats.includes(next.category)) {
      next.category = validCats.includes('其他') ? '其他' : ''
    }
  }
  // 单位不在设置列表里时保留用户原值，原值也不合法则回退到第一个可选单位
  if (next.unit && units.length && !units.includes(next.unit)) next.unit = units[0] || '个'

  // 与扫描入库一致：非食用品分类自动切换到 daily
  if (next.category && next.category !== '非食材') {
    next.stock_type = dailyCats.includes(next.category) ? 'daily' : 'food'
  }
  return next
}
