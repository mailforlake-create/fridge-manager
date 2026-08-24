import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, batchFetchIn } from '../lib/supabase'
import DiningHistory from './DiningHistory'
import { recognizeReceipt } from '../lib/aiRecognition'
import { FOOD_CATEGORIES as DEFAULT_FOOD_CATS, DAILY_CATEGORIES as DEFAULT_DAILY_CATS, UNITS as DEFAULT_UNITS } from '../lib/categories'
import { useSettings } from '../context/SettingsContext'
import { formatAmount } from '../lib/currency'
import { toJPY } from '../lib/currency'

function calcExpiry(mfgDate, shelfDays) {
  if (!mfgDate || !shelfDays) return ''
  const d = new Date(mfgDate)
  d.setDate(d.getDate() + Number(shelfDays))
  return d.toISOString().split('T')[0]
}


const smallField = {
  width: '100%', padding: '6px 8px', borderRadius: 7, fontSize: 13,
  border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff', boxSizing: 'border-box'
}

function ItemDetailModal({ item, onClose }) {
  const { settings } = useSettings()
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1001
    }}>
      <div style={{
        background: '#fff', borderRadius: '16px 16px 0 0', padding: 20,
        width: '100%', maxWidth: 430, maxHeight: '70vh', overflowY: 'auto'
      }}>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 16 }}>{item.name_zh}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['原文名称', item.name_original],
            ['分类', item.category],
            ['数量', item.quantity && item.unit ? `${item.quantity}${item.unit}` : null],
            ['实付价格', item.price ? formatAmount(item.price, settings) : null],,
            ['原价', item.original_price ? formatAmount(item.original_price, settings) : null],
            ['折扣说明', item.discount_info],
            ['过期日期', item.expiry_date],
            ['备注', item.memo],
          ].filter(([, v]) => v).map(([label, value]) => (
            <div key={label} style={{ display: 'flex', gap: 12 }}>
              <span style={{ fontSize: 13, color: '#94a3b8', width: 72, flexShrink: 0 }}>{label}</span>
              <span style={{ fontSize: 14, color: '#1e293b' }}>{value}</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#94a3b8', width: 72, flexShrink: 0 }}>入库状态</span>
            <span style={{ fontSize: 14 }}>
              {!item.add_to_fridge
                ? <span style={{ color: '#94a3b8' }}>未入库</span>
                : item.is_fully_consumed
                  ? <span style={{ color: '#94a3b8' }}>已使用</span>
                  : <span style={{ color: '#16a34a' }}>已入库</span>
              }
            </span>
          </div>
        </div>
        <button onClick={onClose} style={{
          width: '100%', marginTop: 20, padding: '12px 0', borderRadius: 12,
          background: '#f1f5f9', color: '#475569', fontSize: 15, fontWeight: 600
        }}>关闭</button>
      </div>
    </div>
  )
}



/**
 * 入库结果弹窗 — 逐条显示物品入库状态，插入后查库验证，失败自动重试
 */
function StorageResultModal({ storageItems, onFinish }) {
  const [results, setResults] = useState(() => {
    const r = {}
    storageItems.forEach(item => { r[item.tempId] = 'pending' })
    return r
  })
  // summaryInfo: { totalBefore, totalInsert, totalAfter }
  const [summaryInfo, setSummaryInfo] = useState(null)
  const [phaseText, setPhaseText] = useState('正在逐条入库...')
  const [done, setDone] = useState(false)
  const runningRef = useRef(false)

  // 查询各表中未消耗的总件数（不含已消耗）— 分页拉全量，规避 PostgREST max_rows=1000 静默截断
  async function queryStockByTable() {
    const result = { ingredients: 0, daily_items: 0 }
    const PAGE_SIZE = 1000
    for (const table of ['ingredients', 'daily_items']) {
      try {
        const rows = []
        let from = 0
        while (true) {
          const { data, error } = await supabase
            .from(table)
            .select('quantity, consumed_quantity')
            .range(from, from + PAGE_SIZE - 1)
          if (error) break
          if (!data || data.length === 0) break
          rows.push(...data)
          if (data.length < PAGE_SIZE) break // 不足一页说明已取完
          from += PAGE_SIZE
        }
        // 统计"未消耗的物品件数"，与物品页面左上角逻辑一致
        result[table] = rows.filter(r => {
          const qty = Number(r.quantity) || 0
          const consumed = Number(r.consumed_quantity) || 0
          return qty > consumed
        }).length
      } catch { /* 忽略查询错误 */ }
    }
    return result
  }

  useEffect(() => {
    if (runningRef.current) return
    runningRef.current = true
    runStorage()
  }, [])

  const finalFailedRef = useRef([])

  async function runStorage() {
    finalFailedRef.current = []

    // ---- 先查询总库存（不含已消耗）----
    const stockByTable = await queryStockByTable()
    // 统计条目数：一个条目个数为多个时按 1 计算
    const insertFood = storageItems
      .filter(item => item.table === 'ingredients')
      .length
    const insertDaily = storageItems
      .filter(item => item.table === 'daily_items')
      .length
    setSummaryInfo({
      foodBefore: stockByTable.ingredients,
      foodInsert: insertFood,
      foodAfter: stockByTable.ingredients + insertFood,
      dailyBefore: stockByTable.daily_items,
      dailyInsert: insertDaily,
      dailyAfter: stockByTable.daily_items + insertDaily,
      hasFood: insertFood > 0,
      hasDaily: insertDaily > 0
    })

    // ---- 第一轮：逐条入库 ----
    const firstFailed = []
    for (const item of storageItems) {
      setResults(r => ({ ...r, [item.tempId]: 'processing' }))
      try {
        const { data, error } = await supabase.from(item.table).insert(item.data).select()
        if (error) throw new Error(error.message)
        if (!data || !data[0] || !data[0].id) throw new Error('数据库返回数据异常，未获取到记录ID')
        // ★ 关键：查询数据库确认该记录已持久化
        const { data: verify, error: verifyError } = await supabase
          .from(item.table).select('id').eq('id', data[0].id)
        if (verifyError) throw new Error('入库后验证查询失败: ' + verifyError.message)
        if (!verify || verify.length === 0) throw new Error('入库后未能在数据库中查询到该记录')
        setResults(r => ({ ...r, [item.tempId]: 'success' }))
        if (item.purchaseItemId) {
          await supabase.from('purchase_items').update({ add_to_fridge: true }).eq('id', item.purchaseItemId)
        }
      } catch (e) {
        firstFailed.push({ ...item, error: e.message })
        setResults(r => ({ ...r, [item.tempId]: 'failed' }))
      }
    }

    // ---- 第二轮：重试失败项 ----
    if (firstFailed.length > 0) {
      setPhaseText(`正在重试 ${firstFailed.length} 件失败商品...`)
      for (const item of firstFailed) {
        setResults(r => ({ ...r, [item.tempId]: 'processing' }))
        try {
          const { data, error } = await supabase.from(item.table).insert(item.data).select()
          if (error) throw new Error(error.message)
          if (!data || !data[0] || !data[0].id) throw new Error('重试时数据库返回数据异常')
          const { data: verify, error: verifyError } = await supabase
            .from(item.table).select('id').eq('id', data[0].id)
          if (verifyError) throw new Error('重试后验证查询失败: ' + verifyError.message)
          if (!verify || verify.length === 0) throw new Error('重试后仍未在数据库中查询到该记录')
          setResults(r => ({ ...r, [item.tempId]: 'success' }))
          if (item.purchaseItemId) {
            await supabase.from('purchase_items').update({ add_to_fridge: true }).eq('id', item.purchaseItemId)
          }
        } catch (e) {
          finalFailedRef.current.push({ name: item.name, type: item.type, error: e.message })
          setResults(r => ({ ...r, [item.tempId]: 'failed' }))
          if (item.purchaseItemId) {
            try {
              const { data: existing } = await supabase
                .from('purchase_items').select('memo').eq('id', item.purchaseItemId).single()
              const oldMemo = existing?.memo || ''
              const newMemo = oldMemo ? `${oldMemo}; 入库失败: ${e.message}` : `入库失败: ${e.message}`
              await supabase.from('purchase_items')
                .update({ add_to_fridge: false, memo: newMemo }).eq('id', item.purchaseItemId)
            } catch (memoErr) { console.error('更新失败备注出错：', memoErr) }
          }
        }
      }
    }

    setPhaseText(finalFailedRef.current.length === 0 ? '全部入库成功 ✅' : `入库完成，${finalFailedRef.current.length} 件失败 ❌`)
    setDone(true)
    // 不移除弹窗，让用户手动点击按钮关闭
  }


  const statusIcon = (s) => s === 'pending' ? '⏳' : s === 'processing' ? '🔄' : s === 'success' ? '✅' : '❌'

  const successCount = Object.values(results).filter(s => s === 'success').length
  const totalCount = storageItems.length
  const failedCount = Object.values(results).filter(s => s === 'failed').length

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000
    }}>
      <div style={{
        background: '#fff', borderRadius: 16,
        width: '100%', maxWidth: 430,
        position: 'relative', maxHeight: '90vh'
      }}>
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>📦 物品入库</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>
            {phaseText}
            {!done && <span style={{ marginLeft: 8, fontSize: 12, color: '#94a3b8' }}>{successCount}/{totalCount}</span>}
          </div>
          {summaryInfo && (
            <div style={{
              marginBottom: 10, padding: '8px 12px', borderRadius: 8,
              background: '#f1f5f9', fontSize: 12, color: '#475569'
            }}>
              {summaryInfo.hasFood && (
                <div style={{ marginBottom: summaryInfo.hasDaily ? 4 : 0 }}>
                  🥦 食用品 — 入库前: <b>{summaryInfo.foodBefore}</b> ｜ 入库: <b>{summaryInfo.foodInsert}</b> ｜ 入库后: <b>{summaryInfo.foodAfter}</b>
                </div>
              )}
              {summaryInfo.hasDaily && (
                <div>
                  🧴 非食用品 — 入库前: <b>{summaryInfo.dailyBefore}</b> ｜ 入库: <b>{summaryInfo.dailyInsert}</b> ｜ 入库后: <b>{summaryInfo.dailyAfter}</b>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{
          overflowY: 'auto',
          padding: '0 20px',
          maxHeight: done ? 'calc(90vh - 140px)' : 'calc(90vh - 80px)'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {storageItems.map(item => (
              <div key={item.tempId} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 10,
                background: results[item.tempId] === 'success' ? '#f0fdf4'
                  : results[item.tempId] === 'failed' ? '#fef2f2'
                  : results[item.tempId] === 'processing' ? '#fefce8' : '#f8fafc'
              }}>
                <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>
                  {statusIcon(results[item.tempId] || 'pending')}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.type}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '12px 20px 20px', borderTop: '1px solid #e2e8f0', background: '#fff' }}>
          <button
            onClick={() => onFinish({ failedItems: finalFailedRef.current })}
            disabled={!done}
            style={{
              width: '100%', padding: '12px 0', borderRadius: 12,
              background: !done ? '#cbd5e1' : (failedCount > 0 ? '#f59e0b' : '#16a34a'),
              color: '#fff', fontSize: 15, fontWeight: 700, border: 'none',
              cursor: done ? 'pointer' : 'not-allowed'
            }}
          >
            {!done ? `入库中... ${successCount}/${totalCount}` : (failedCount > 0 ? `关闭（${failedCount} 件失败）` : '完成')}
          </button>
        </div>
      </div>
    </div>
  )
}



function ReceiptScanModal({ onClose, onSaved }) {
  const [currency, setCurrency] = useState('JPY')
  const [aiItems, setAiItems] = useState([])
  const [selected, setSelected] = useState({})
  const [receiptData, setReceiptData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [storeName, setStoreName] = useState('')
  const [storeNameOriginal, setStoreNameOriginal] = useState('')
  const [purchasedAt, setPurchasedAt] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [showStorageResult, setShowStorageResult] = useState(false)
  const [storageItems, setStorageItems] = useState([])
  const { settings } = useSettings()
const UNITS = settings.food_units?.length ? settings.food_units : DEFAULT_UNITS
const FOOD_CATS = settings.food_categories?.length ? settings.food_categories : DEFAULT_FOOD_CATS
const DAILY_CATS = settings.daily_categories?.length ? settings.daily_categories : DEFAULT_DAILY_CATS
const FOOD_CATEGORIES = FOOD_CATS
const DAILY_CATEGORIES = DAILY_CATS
const isDailyCategory = (category) => DAILY_CATS.includes(category)

  const smallField = {
    width: '100%', padding: '6px 8px', borderRadius: 7, fontSize: 13,
    border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff', boxSizing: 'border-box'
  }

  const setItemField = useCallback((i, k, v) => {
    setAiItems(items => { const n = [...items]; n[i] = { ...n[i], [k]: v }; return n })
  }, [])

  function toStoredPurchaseItemPrice(price) {
    if (price === '' || price == null) return null
    const numericPrice = Number(price)
    if (!Number.isFinite(numericPrice)) return null
    return currency === 'JPY' ? numericPrice : toJPY(numericPrice, currency, settings)
  }

  async function handleFile(file) {
    setLoading(true)
    try {
      const data = await recognizeReceipt(file)
      if (data && data.items) {
        setReceiptData(data)
        setStoreName(data.store_name || '')
        setStoreNameOriginal(data.store_name_original || '')
        setPurchasedAt(data.purchased_at || '')
        setTotalAmount(data.total_amount != null ? String(data.total_amount) : '')
        const items = data.items.map(i => ({ ...i, mfg_date: '', shelf_days: '', memo: '' }))
        setAiItems(items)
        const sel = {}
        items.forEach((item, i) => { sel[i] = !isDailyCategory(item.category) && item.category !== '非食材' ? true : isDailyCategory(item.category) ? true : false })
        setSelected(sel)
      } else {
        alert('小票识别失败，请重试')
      }
    } catch (e) { alert('识别失败：' + e.message) }
    setLoading(false)
  }

  async function save() {
    setSaving(true)
    try {
        const originalAmount = totalAmount !== '' ? Number(totalAmount) : null
        const jpyAmount = currency === 'JPY' ? originalAmount : toJPY(originalAmount, currency, settings)

        const { data: history } = await supabase
          .from('purchase_history')
          .insert({
            store_name: storeName || '未知商家',
            store_name_original: storeNameOriginal || null,
            purchased_at: purchasedAt || null,
            total_amount: jpyAmount,
            original_amount: currency !== 'JPY' ? originalAmount : null,
            currency: currency
          }).select().single()

      if (history) {
        // 给每个 item 加临时 id，用于后续可靠映射
        const itemsWithTempId = aiItems.map((item, i) => ({ ...item, _tempId: i }))

        const historyItems = itemsWithTempId.map(item => ({
          history_id: history.id,
          name_zh: item.name_zh,
          name_original: item.name_original || null,
          category: item.category || null,
          quantity: Number(item.quantity) || 1,
          unit: item.unit || '个',
          price: toStoredPurchaseItemPrice(item.price),
          original_price: toStoredPurchaseItemPrice(item.original_price),
          is_discount: item.is_discount || false,
          discount_info: item.discount_info || null,
          add_to_fridge: selected[item._tempId] && !isDailyCategory(item.category) && item.category !== '非食材',
          expiry_date: item.expiry_date || null,
          memo: item.memo || null,
        }))

        const savedItems = []
          for (const historyItem of historyItems) {
            const { data } = await supabase
              .from('purchase_items')
              .insert(historyItem)
              .select()
              .single()
            savedItems.push(data)
          }

        // 使用 name_zh + history_id 进行映射，避免数组索引错位
        const purchaseItemMap = {}
        savedItems?.forEach(saved => {
          const original = historyItems.find(h =>
            h.name_zh === saved.name_zh && h.history_id === saved.history_id
          )
          if (original) {
            // 反查 _tempId：从 itemsWithTempId 中找到匹配的
            const matched = itemsWithTempId.find(item =>
              item.name_zh === saved.name_zh && item._tempId !== undefined
            )
            if (matched) purchaseItemMap[matched._tempId] = saved.id
          }
        })

        // ★ 改造：收集待入库物品，委托 StorageResultModal 处理
        const inventoryItems = []

        // 食用品
        itemsWithTempId
          .filter((item) => selected[item._tempId] && !isDailyCategory(item.category) && item.category !== '非食材')
          .forEach(item => {
            const tid = item._tempId
            inventoryItems.push({
              tempId: `food_${tid}`,
              name: item.name_zh,
              type: '食用品',
              table: 'ingredients',
              data: {
                name_zh: item.name_zh,
                name_original: item.name_original || null,
                category: item.category || null,
                quantity: Number(item.quantity) || 1,
                unit: item.unit || '个',
                expiry_date: item.expiry_date || null,
                memo: item.memo || null,
                location: 'fridge',
                purchase_item_id: purchaseItemMap[tid] || null
              },
              purchaseItemId: purchaseItemMap[tid] || null
            })
          })

        // 非食用品
        itemsWithTempId
          .filter((item) => selected[item._tempId] && isDailyCategory(item.category))
          .forEach(item => {
            const tid = item._tempId
            inventoryItems.push({
              tempId: `daily_${tid}`,
              name: item.name_zh,
              type: '非食用品',
              table: 'daily_items',
              data: {
                name_zh: item.name_zh,
                name_original: item.name_original || null,
                category: item.category || null,
                quantity: Number(item.quantity) || 1,
                unit: item.unit || '个',
                location: 'home',
                memo: item.memo || null,
                purchase_item_id: purchaseItemMap[tid] || null
              },
              purchaseItemId: purchaseItemMap[tid] || null
            })
          })

        // 保存到 state，打开 StorageResultModal
        setStorageItems(inventoryItems)
        setShowStorageResult(true)
        setSaving(false)
      }
    } catch (e) {
      alert('保存失败：' + e.message)
      setSaving(false)
    }
  }

  function onStorageFinish({ failedItems }) {
    setShowStorageResult(false)
    if (!failedItems || failedItems.length === 0) {
      onSaved()
      onClose()
    } else {
      const detail = failedItems.map(f => `・${f.name}（${f.type}）: ${f.error}`).join('\n')
      alert(`以下 ${failedItems.length} 件商品重试后仍入库失败，已标记为未入库并在备注中记录：\n\n${detail}`)
      onSaved()
      onClose()
    }
  }

  return (
    <>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>扫描小票</div>
          <button onClick={onClose} style={{ background: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#16a34a' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>✨</div>AI 识别中，请稍候...
          </div>
        )}

        {!loading && !receiptData && (
          <div>
            <input type="file" accept="image/*" style={{ display: 'none' }} id="scan-receipt-input"
              onChange={e => { const f = e.target.files[0]; e.target.value = ''; handleFile(f) }} />
            <button onClick={() => document.getElementById('scan-receipt-input').click()} style={{
              width: '100%', padding: '40px 0', borderRadius: 14,
              border: '2px dashed #cbd5e1', background: '#f8fafc',
              color: '#64748b', fontSize: 15, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8
            }}>
              <span style={{ fontSize: 40 }}>🧾</span>
              <span style={{ fontWeight: 600 }}>拍摄或选择购物小票</span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>识别商家、价格、折扣信息</span>
            </button>
          </div>
        )}

        {!loading && receiptData && (
          <div>
            <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>商家名称</div>
              <input style={{ ...smallField, marginBottom: 6, fontWeight: 600, color: '#16a34a', fontSize: 14 }}
                value={storeName} onChange={e => setStoreName(e.target.value)}
                placeholder="商家名称" />
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>商家原文名称</div>
              <input style={{ ...smallField, marginBottom: 6 }}
                value={storeNameOriginal} onChange={e => setStoreNameOriginal(e.target.value)}
                placeholder="商家原文名称（可选）" />
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>购买日期</div>
                  <input style={smallField} type="date" value={purchasedAt}
                    onChange={e => setPurchasedAt(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>合计金额（¥）</div>
                  <input style={smallField} type="number" value={totalAmount}
                    onChange={e => setTotalAmount(e.target.value)} placeholder="可选" />
                </div>
              </div>              
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#475569' }}>录入货币</div>
                <select value={currency} onChange={e => setCurrency(e.target.value)}
                  style={{ padding: '5px 10px', borderRadius: 7, fontSize: 13, border: '1.5px solid #e2e8f0', outline: 'none' }}>
                  {(settings.exchange_rates || []).map(r => (
                    <option key={r.to} value={r.to}>{r.label}（{r.to}）</option>
                  ))}
                </select>
              </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>
                识别到 {aiItems.length} 件，勾选入库：
              </div>
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
                  background: selected[i] ? (isDailyCategory(item.category) ? '#eff6ff' : '#f0fdf4') : '#f8fafc',
                  border: `1.5px solid ${selected[i] ? (isDailyCategory(item.category) ? '#3b82f6' : '#16a34a') : '#e2e8f0'}`,
                  borderRadius: 12, padding: '10px 12px'
                }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div onClick={() => setSelected(s => ({ ...s, [i]: !s[i] }))} style={{
                      width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 2, cursor: 'pointer',
                      border: `2px solid ${selected[i] ? (isDailyCategory(item.category) ? '#3b82f6' : '#16a34a') : '#cbd5e1'}`,
                      background: selected[i] ? (isDailyCategory(item.category) ? '#3b82f6' : '#16a34a') : 'transparent',
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
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <select style={{ ...smallField, flex: 1 }} value={item.category || ''}
                          onChange={e => setItemField(i, 'category', e.target.value)}>
                          <option value="">分类</option>
                          <optgroup label="食用品">
                            {FOOD_CATS.map(c => <option key={c}>{c}</option>)}
                          </optgroup>
                          <optgroup label="非食用品">
                            {DAILY_CATS.map(c => <option key={c}>{c}</option>)}
                          </optgroup>
                          <option value="杂物">杂物（不入库）</option>
                        </select>
                        {isDailyCategory(item.category) && (
                          <span style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600, whiteSpace: 'nowrap' }}>→非食用品</span>
                        )}
                        {item.price && (
                          <span style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                            {item.is_discount && <span style={{ color: '#ef4444' }}>折扣 </span>}
                            {formatAmount(item.price, settings)}
                          </span>
                        )}
                      </div>
                      {item.name_original && (
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.name_original}</div>
                      )}
                      <input style={smallField} value={item.memo || ''} placeholder="备注（可选）"
                        onChange={e => setItemField(i, 'memo', e.target.value)} />
                      {!isDailyCategory(item.category) && item.category !== '非食材' && (
                        <input style={smallField} type="date" value={item.expiry_date || ''}
                          onChange={e => setItemField(i, 'expiry_date', e.target.value)} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setReceiptData(null); setAiItems([]); setSelected({}); setStoreName(''); setStoreNameOriginal(''); setPurchasedAt(''); setTotalAmount('') }} style={{
                flex: 1, padding: '12px 0', borderRadius: 12, background: '#f1f5f9', color: '#475569', fontSize: 14, fontWeight: 600
              }}>重新识别</button>
              <button onClick={save} disabled={saving} style={{
                flex: 2, padding: '12px 0', borderRadius: 12, background: '#16a34a', color: '#fff', fontSize: 15, fontWeight: 700
              }}>{saving ? '保存中...' : '保存小票'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
    {showStorageResult && (
      <StorageResultModal
        storageItems={storageItems}
        onFinish={onStorageFinish}
      />
    )}
    </>
  )
}

function ManualReceiptModal({ onClose, onSaved }) {
  const isDailyCategory = (category) => DAILY_CATS.includes(category)
  const [header, setHeader] = useState({
    store_name: '',
    store_name_original: '',
    purchased_at: new Date().toISOString().split('T')[0],
    total_amount: ''
  })
  const [items, setItems] = useState([{
    name_zh: '', name_original: '', category: '', quantity: 1, unit: '个',
    price: '', original_price: '', is_discount: false, discount_info: '', memo: '',
    expiry_date: '', add_to_fridge: true
  }])
  const [saving, setSaving] = useState(false)
  const [showManualStorageResult, setShowManualStorageResult] = useState(false)
  const [manualStorageItems, setManualStorageItems] = useState([])

  const smallField = {
    width: '100%', padding: '6px 8px', borderRadius: 7, fontSize: 13,
    border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff', boxSizing: 'border-box'
  }
  const field = {
    width: '100%', padding: '9px 12px', borderRadius: 9, fontSize: 14,
    border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff', boxSizing: 'border-box'
  }

  function setItemField(i, k, v) {
    setItems(items => {
      const n = [...items]
      n[i] = { ...n[i], [k]: v }
      return n
    })
  }

  function addItem() {
    setItems(i => [...i, {
      name_zh: '', name_original: '', category: '', quantity: 1, unit: '个',
      price: '', original_price: '', is_discount: false, discount_info: '', memo: '',
      expiry_date: '', add_to_fridge: true
    }])
  }

  function removeItem(i) {
    setItems(items => items.filter((_, j) => j !== i))
  }

  async function save() {
    if (!header.store_name.trim()) return alert('请输入商家名称')
    if (!header.purchased_at) return alert('请输入购买日期')
    const validItems = items.filter(i => i.name_zh.trim())
    if (validItems.length === 0) return alert('请至少添加一件商品')

    setSaving(true)
    try {
      const { data: history, error: historyError } = await supabase
        .from('purchase_history')
        .insert({
          store_name: header.store_name,
          store_name_original: header.store_name_original || null,
          purchased_at: header.purchased_at,
          total_amount: header.total_amount !== '' ? Number(header.total_amount) : null
        })
        .select().single()

      if (historyError) { console.error('履历保存失败：', historyError); alert('保存失败：' + historyError.message); setSaving(false); return }

      // 给每个 item 加临时 id
      const itemsWithTempId = validItems.map((item, i) => ({ ...item, _tempId: i }))

      const historyItems = itemsWithTempId.map(item => ({
        history_id: history.id,
        name_zh: item.name_zh,
        name_original: item.name_original || null,
        category: item.category || null,
        quantity: Number(item.quantity) || 1,
        unit: item.unit || '个',
        price: item.price !== '' ? Number(item.price) : null,
        original_price: item.original_price !== '' ? Number(item.original_price) : null,
        is_discount: item.is_discount,
        discount_info: item.discount_info || null,
        memo: item.memo || null,
        expiry_date: item.expiry_date || null,
        add_to_fridge: item.add_to_fridge && item.category !== '非食材'
      }))

      const savedItems = []
        for (const historyItem of historyItems) {
          const { data } = await supabase
            .from('purchase_items')
            .insert(historyItem)
            .select()
            .single()
          savedItems.push(data)
        }

      if (itemsError) { console.error('商品保存失败：', itemsError); alert('保存失败：' + itemsError.message); setSaving(false); return }

      // 使用 name_zh + history_id 进行映射，避免数组索引错位
      const purchaseItemMap = {}
      savedItems?.forEach(saved => {
        const matched = itemsWithTempId.find(item =>
          item.name_zh === saved.name_zh && item._tempId !== undefined
        )
        if (matched) purchaseItemMap[matched._tempId] = saved.id
      })

      // ★ 改造：收集待入库物品，委托 StorageResultModal 处理
      const inventoryItems = []

      // 食用品（修正原有 ({ item }) 解构错误）
      itemsWithTempId
        .filter((item) => item.add_to_fridge && (item.stock_type || 'food') === 'food' && item.category !== '非食材')
        .forEach(item => {
          const tid = item._tempId
          inventoryItems.push({
            tempId: `food_${tid}`,
            name: item.name_zh,
            type: '食用品',
            table: 'ingredients',
            data: {
              name_zh: item.name_zh,
              name_original: item.name_original || null,
              category: item.category || null,
              quantity: Number(item.quantity) || 1,
              unit: item.unit || '个',
              expiry_date: item.expiry_date || null,
              memo: item.memo || null,
              location: 'fridge',
              purchase_item_id: purchaseItemMap[tid] || null
            },
            purchaseItemId: purchaseItemMap[tid] || null
          })
        })

      // 非食用品（修正原有 ({ item }) 解构错误）
      itemsWithTempId
        .filter((item) => item.add_to_fridge && item.stock_type === 'daily')
        .forEach(item => {
          const tid = item._tempId
          inventoryItems.push({
            tempId: `daily_${tid}`,
            name: item.name_zh,
            type: '非食用品',
            table: 'daily_items',
            data: {
              name_zh: item.name_zh,
              name_original: item.name_original || null,
              category: item.category || null,
              quantity: Number(item.quantity) || 1,
              unit: item.unit || '个',
              location: 'home',
              memo: item.memo || null,
              purchase_item_id: purchaseItemMap[tid] || null
            },
            purchaseItemId: purchaseItemMap[tid] || null
          })
        })

      // 保存到 state，打开 StorageResultModal
      setManualStorageItems(inventoryItems)
      setShowManualStorageResult(true)
    } catch (e) {
      console.error('保存异常：', e)
      alert('保存失败：' + e.message)
      setSaving(false)
    }
  }

  function onManualStorageFinish({ failedItems }) {
    setShowManualStorageResult(false)
    if (!failedItems || failedItems.length === 0) {
      onSaved()
      onClose()
    } else {
      const detail = failedItems.map(f => `・${f.name}（${f.type}）: ${f.error}`).join('\n')
      alert(`以下 ${failedItems.length} 件商品重试后仍入库失败，已标记为未入库并在备注中记录：\n\n${detail}`)
      onSaved()
      onClose()
    }
  }

  return (
    <>
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        background: '#fff', borderRadius: '16px 16px 0 0', padding: 20,
        width: '100%', maxWidth: 430, maxHeight: '92vh', overflowY: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>手动录入小票</div>
          <button onClick={onClose} style={{ background: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ background: '#f8fafc', borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 10 }}>小票信息</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>商家名称（中文）*</div>
              <input style={field} value={header.store_name}
                onChange={e => setHeader(h => ({ ...h, store_name: e.target.value }))}
                placeholder="例：罗皮亚" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>商家原文名称</div>
              <input style={field} value={header.store_name_original}
                onChange={e => setHeader(h => ({ ...h, store_name_original: e.target.value }))}
                placeholder="例：ロピア" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>购买日期*</div>
                <input style={field} type="date" value={header.purchased_at}
                  onChange={e => setHeader(h => ({ ...h, purchased_at: e.target.value }))} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>合计金额（¥）</div>
                <input style={field} type="number" value={header.total_amount}
                  onChange={e => setHeader(h => ({ ...h, total_amount: e.target.value }))}
                  placeholder="可选" />
              </div>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 10 }}>
          商品明细（{items.length} 件）
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
          {items.map((item, i) => (
            <div key={i} style={{
              background: '#f8fafc', borderRadius: 12, padding: 12,
              border: '1.5px solid #e2e8f0'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>第 {i + 1} 件</div>
                {items.length > 1 && (
                  <button onClick={() => removeItem(i)} style={{
                    background: '#fef2f2', color: '#ef4444', fontSize: 12,
                    padding: '2px 8px', borderRadius: 6, fontWeight: 600
                  }}>删除</button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ ...smallField, flex: 2 }} value={item.name_zh}
                    onChange={e => setItemField(i, 'name_zh', e.target.value)}
                    placeholder="商品名称（中文）" />
                  <input style={{ ...smallField, flex: 1 }} value={item.name_original}
                    onChange={e => setItemField(i, 'name_original', e.target.value)}
                    placeholder="原文" />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ ...smallField, flex: 1, textAlign: 'center' }} type="number"
                    value={item.quantity}
                    onChange={e => setItemField(i, 'quantity', e.target.value)} />
                  <select style={{ ...smallField, flex: 1 }} value={item.unit}
                    onChange={e => setItemField(i, 'unit', e.target.value)}>
                    {UNITS.map(u => <option key={u}>{u}</option>)}
                  </select>
                  <select style={{ ...smallField, flex: 2 }} value={item.category}
                    onChange={e => setItemField(i, 'category', e.target.value)}>
                    <option value="">分类</option>
                    <optgroup label="食用品">
                      {FOOD_CATS.map(c => <option key={c}>{c}</option>)}
                    </optgroup>
                    <optgroup label="非食用品">
                      {DAILY_CATS.map(c => <option key={c}>{c}</option>)}
                    </optgroup>
                    <option value="非食材">非食材（不入库）</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>实付价格</div>
                    <input style={smallField} type="number" value={item.price}
                      onChange={e => setItemField(i, 'price', e.target.value)} placeholder="¥" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>原价</div>
                    <input style={smallField} type="number" value={item.original_price}
                      onChange={e => setItemField(i, 'original_price', e.target.value)} placeholder="¥" />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={item.is_discount}
                    onChange={e => setItemField(i, 'is_discount', e.target.checked)}
                    style={{ width: 15, height: 15, accentColor: '#ef4444' }} />
                  <span style={{ fontSize: 12, color: '#475569' }}>折扣商品</span>
                  {item.is_discount && (
                    <input style={{ ...smallField, flex: 1 }} value={item.discount_info}
                      onChange={e => setItemField(i, 'discount_info', e.target.value)}
                      placeholder="折扣说明" />
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>过期日期</div>
                  <input style={smallField} type="date" value={item.expiry_date}
                    onChange={e => setItemField(i, 'expiry_date', e.target.value)} />
                </div>
                <input style={smallField} value={item.memo}
                  onChange={e => setItemField(i, 'memo', e.target.value)}
                  placeholder="备注（可选）" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <input type="checkbox" checked={item.add_to_fridge}
                    onChange={e => setItemField(i, 'add_to_fridge', e.target.checked)}
                    style={{ width: 15, height: 15, accentColor: '#16a34a' }} />
                  <span style={{ fontSize: 12, color: '#475569' }}>入库</span>
                  {item.add_to_fridge && (
                    <div style={{ display: 'flex', gap: 5 }}>
                      {[['food','食用品'],['daily','非食用品']].map(([v, l]) => (
                        <button key={v} onClick={() => setItemField(i, 'stock_type', v)} style={{
                          padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                          background: (item.stock_type || 'food') === v ? (v === 'food' ? '#16a34a' : '#3b82f6') : '#f1f5f9',
                          color: (item.stock_type || 'food') === v ? '#fff' : '#94a3b8'
                        }}>{l}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <button onClick={addItem} style={{
          width: '100%', padding: '10px 0', borderRadius: 10, marginBottom: 16,
          background: '#f1f5f9', color: '#475569', fontSize: 14, fontWeight: 600,
          border: '1.5px dashed #cbd5e1'
        }}>+ 添加商品</button>

        <button onClick={save} disabled={saving} style={{
          width: '100%', padding: '13px 0', borderRadius: 12,
          background: '#16a34a', color: '#fff', fontSize: 15, fontWeight: 700
        }}>{saving ? '保存中...' : '保存小票'}</button>
      </div>
    </div>
    {showManualStorageResult && (
      <StorageResultModal
        storageItems={manualStorageItems}
        onFinish={onManualStorageFinish}
      />
    )}
    </>
  )
}

export default function PurchaseHistory() {
  const { settings, saveSetting } = useSettings()
  const [showAddItems, setShowAddItems] = useState(false)
  const [newItems, setNewItems] = useState([])
  const [showManualAdd, setShowManualAdd] = useState(false)
  const [history, setHistory] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [editingItem, setEditingItem] = useState(null)
  const [editingHistory, setEditingHistory] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [detailItem, setDetailItem] = useState(null)
  const [showReceiptScan, setShowReceiptScan] = useState(false)
  const [collapsedYears, setCollapsedYears] = useState({})
  const [collapsedMonths, setCollapsedMonths] = useState({})
  const [syncToIngredients, setSyncToIngredients] = useState(true)
  const [syncToDining, setSyncToDining] = useState(true)
  const [syncDeleteStock, setSyncDeleteStock] = useState(true)
const UNITS = settings.food_units?.length ? settings.food_units : DEFAULT_UNITS
const FOOD_CATS = settings.food_categories?.length ? settings.food_categories : DEFAULT_FOOD_CATS
const DAILY_CATS = settings.daily_categories?.length ? settings.daily_categories : DEFAULT_DAILY_CATS
const FOOD_CATEGORIES = FOOD_CATS
const DAILY_CATEGORIES = DAILY_CATS
const isDailyCategory = (category) => DAILY_CATS.includes(category)

  useEffect(() => { fetchHistory() }, [])

  async function fetchHistory() {
    setLoading(true)
    // 拆嵌套：先查主表（裁剪无用字段），再用 IN 批量查明细（走 idx_purchase_items_history_id 索引）
    const { data: historyData, error } = await supabase
      .from('purchase_history')
      .select('id, store_name, store_name_original, purchased_at, created_at, total_amount, currency, original_amount')
      .order('purchased_at', { ascending: false, nullsFirst: false })

    if (error) {
      console.warn('Failed to fetch purchase history:', error)
      setHistory([])
      setLoading(false)
      return
    }

    const records = historyData || []
    const itemsByHistoryId = new Map()
    if (records.length) {
      const historyIds = records.map(r => r.id)
      const items = await batchFetchIn('purchase_items', 'history_id', historyIds, '*')
      ;(items || []).forEach(item => {
        const list = itemsByHistoryId.get(item.history_id) || []
        list.push(item)
        itemsByHistoryId.set(item.history_id, list)
      })
    }

    setHistory(records.map(r => ({ ...r, purchase_items: itemsByHistoryId.get(r.id) || [] })))
    setLoading(false)
  }

  function confirmDeleteHistory(h) {
    setConfirm({
      title: `删除「${h.store_name || '未知商家'}」的购物记录`,
      message: '同步更新物品库存？',
      onYes: () => deleteHistory(h, true),
      onNo: () => deleteHistory(h, false),
      onCancel: () => setConfirm(null)
    })
  }


    async function restockItem(item) {
    const isDaily = isDailyCategory(item.category)

    // 防重复：先检查该 purchase_item 是否已入库过
    const table = isDaily ? 'daily_items' : 'ingredients'
    const { data: existing } = await supabase
      .from(table)
      .select('id')
      .eq('purchase_item_id', item.id)
      .limit(1)
    if (existing && existing.length > 0) {
      alert(`该商品已入库过，无需重复入库（${isDaily ? '非食用品' : '食用品'}）`)
      return
    }

    if (isDaily) {
      await supabase.from('daily_items').insert({
        name_zh: item.name_zh,
        name_original: item.name_original || null,
        category: item.category || null,
        quantity: Number(item.quantity) || 1,
        unit: item.unit || '个',
        memo: item.memo || null,
        location: 'home',
        purchase_item_id: item.id
      })
    } else {
      await supabase.from('ingredients').insert({
        name_zh: item.name_zh,
        name_original: item.name_original || null,
        category: item.category || null,
        quantity: Number(item.quantity) || 1,
        unit: item.unit || '个',
        expiry_date: item.expiry_date || null,
        memo: item.memo || null,
        location: 'fridge',
        purchase_item_id: item.id
      })
    }

    // 入库成功后更新 purchase_item 的 add_to_fridge 状态并清除错误 memo
    await supabase.from('purchase_items').update({
      add_to_fridge: true,
      memo: null
    }).eq('id', item.id)

    alert(`已重新入库到${isDaily ? '非食用品' : '食用品'}`)
  }

  async function deleteHistory(h, alsoFridge) {
    setConfirm(null)
    if (alsoFridge) {
      const names = h.purchase_items?.filter(i => i.add_to_fridge).map(i => i.name_zh) || []
      for (const name of names) {
        await supabase.from('ingredients').delete().eq('name_zh', name)
        await supabase.from('daily_items').delete().eq('name_zh', name)
      }
    }
    await supabase.from('purchase_history').delete().eq('id', h.id)
    setHistory(history.filter(x => x.id !== h.id))
  }

  function confirmDeleteItem(historyId, item) {
    setSyncDeleteStock(true)
    setConfirm({ historyId, item })
  }

  async function deleteItem() {
    const { historyId, item } = confirm
    await supabase.from('purchase_items').delete().eq('id', item.id)
    if (syncDeleteStock && item.add_to_fridge) {
      await supabase.from('ingredients').delete().eq('purchase_item_id', item.id)
      await supabase.from('daily_items').delete().eq('purchase_item_id', item.id)
    }
    setHistory(history.map(h =>
      h.id === historyId
        ? { ...h, purchase_items: h.purchase_items.filter(i => i.id !== item.id) }
        : h
    ))
    setConfirm(null)
    setSyncDeleteStock(true)
  }

  // --- BUG FIX STARTS HERE ---
  // Corrected the nested function declaration syntax error
  async function saveHistoryEdit() {
    let errorMessage = null
    try {
      await supabase.from('purchase_history').update({
        store_name: editingHistory.store_name,
        store_name_original: editingHistory.store_name_original,
        purchased_at: editingHistory.purchased_at || null,
        total_amount: editingHistory.total_amount !== '' && editingHistory.total_amount != null
          ? Number(editingHistory.total_amount) : null
      }).eq('id', editingHistory.id)
    } catch (e) {
      errorMessage = '编辑小票信息失败：' + e.message
    }

    if (!errorMessage && showAddItems && newItems.length > 0) {
      try {
        const validNew = newItems.filter(item => item.name_zh.trim())
        if (validNew.length > 0) {
          const itemsWithTempId = validNew.map((item, i) => ({ ...item, _tempId: i }))

          const historyItems = itemsWithTempId.map(item => ({
            history_id: editingHistory.id,
          name_zh: item.name_zh,
          name_original: item.name_original || null,
          category: item.category || null,
          quantity: Number(item.quantity) || 1,
          unit: item.unit || '个',
          price: item.price !== '' ? Number(item.price) : null,
          original_price: item.original_price !== '' ? Number(item.original_price) : null,
          is_discount: item.is_discount,
          discount_info: item.discount_info || null,
          expiry_date: item.expiry_date || null,
          memo: item.memo || null,
          add_to_fridge: item.add_to_fridge && item.stock_type !== 'none',
        }))

        const { data: savedItems } = await supabase
          .from('purchase_items').insert(historyItems).select()

        // 使用 name_zh 进行映射，避免数组索引错位
        const purchaseItemMap = {}
        savedItems?.forEach(saved => {
          const matched = itemsWithTempId.find(item =>
            item.name_zh === saved.name_zh && item._tempId !== undefined
          )
          if (matched) purchaseItemMap[matched._tempId] = saved.id
        })

        const failedItems = []

        // 逐条插入食用品库存，失败时标记
        const foodItems = itemsWithTempId
          .filter(item => item.add_to_fridge && (item.stock_type || 'food') === 'food')
        for (const item of foodItems) {
          const tid = item._tempId
          try {
            await supabase.from('ingredients').insert({
              name_zh: item.name_zh,
              name_original: item.name_original || null,
              category: item.category || null,
              quantity: Number(item.quantity) || 1,
              unit: item.unit || '个',
              expiry_date: item.expiry_date || null,
              memo: item.memo || null,
              location: 'fridge',
              purchase_item_id: purchaseItemMap[tid] || null
            })
          } catch (e) {
            failedItems.push({ name: item.name_zh, error: e.message, type: '食用品' })
            if (purchaseItemMap[tid]) {
              const existing = await supabase.from('purchase_items').select('memo').eq('id', purchaseItemMap[tid]).single()
              const oldMemo = existing?.data?.memo || ''
              const newMemo = oldMemo ? `${oldMemo}; 入库失败: ${e.message}` : `入库失败: ${e.message}`
              await supabase.from('purchase_items')
                .update({ add_to_fridge: false, memo: newMemo })
                .eq('id', purchaseItemMap[tid])
            }
          }
        }

        // 逐条插入非食用品库存，失败时标记
        const dailyItems = itemsWithTempId
          .filter(item => item.add_to_fridge && item.stock_type === 'daily')
        for (const item of dailyItems) {
          const tid = item._tempId
          try {
            await supabase.from('daily_items').insert({
              name_zh: item.name_zh,
              name_original: item.name_original || null,
              category: item.category || null,
              quantity: Number(item.quantity) || 1,
              unit: item.unit || '个',
              memo: item.memo || null,
              location: 'home',
              purchase_item_id: purchaseItemMap[tid] || null
            })
            if (purchaseItemMap[tid]) {
              await supabase.from('purchase_items').update({ add_to_fridge: true }).eq('id', purchaseItemMap[tid])
            }
          } catch (e) {
            failedItems.push({ name: item.name_zh, error: e.message, type: '非食用品' })
            if (purchaseItemMap[tid]) {
              const existing = await supabase.from('purchase_items').select('memo').eq('id', purchaseItemMap[tid]).single()
              const oldMemo = existing?.data?.memo || ''
              const newMemo = oldMemo ? `${oldMemo}; 入库失败: ${e.message}` : `入库失败: ${e.message}`
              await supabase.from('purchase_items')
                .update({ add_to_fridge: false, memo: newMemo })
                .eq('id', purchaseItemMap[tid])
            }
          }
        }

        if (failedItems.length > 0) {
          const detail = failedItems.map(f => `・${f.name}（${f.type}）: ${f.error}`).join('\n')
          errorMessage = `以下 ${failedItems.length} 件商品入库失败，已标记为未入库：\n\n${detail}`
        }
      }
      } catch (e) {
        errorMessage = '追加商品入库失败：' + e.message
      }
    }

    setEditingHistory(null)
    setShowAddItems(false)
    setNewItems([])

    if (errorMessage) {
      alert(errorMessage)
    }
    fetchHistory()
  }
  // --- BUG FIX ENDS HERE ---

  function confirmSaveItem(item) {
    saveItemEdit(editingItem.historyId, item)
  }

  function normalizeOptionalNumber(value) {
    if (value === '' || value == null) return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function calcSyncedDiningCost(diningItem, ingredient, price) {
    const itemPrice = Number(price) || 0
    const consumedQty = Number(diningItem.consumed_quantity || diningItem.quantity) || 0
    const totalQty = Number(ingredient?.quantity) || 1
    if (!itemPrice || !consumedQty) return 0
    return Math.round((itemPrice * consumedQty / totalQty) * 10) / 10
  }

  async function syncPurchaseItemToDining(item) {
    const { data: ingredients, error: ingredientsError } = await supabase
      .from('ingredients')
      .select('id, quantity')
      .eq('purchase_item_id', item.id)

    if (ingredientsError) throw ingredientsError
    if (!ingredients?.length) return

    const ingredientById = new Map(ingredients.map(ingredient => [String(ingredient.id), ingredient]))
    const ingredientIds = ingredients.map(ingredient => ingredient.id)
    const { data: diningItems, error: itemsError } = await supabase
      .from('dining_items')
      .select('id, dining_id, ingredient_id, quantity, consumed_quantity')
      .in('ingredient_id', ingredientIds)

    if (itemsError) throw itemsError
    if (!diningItems?.length) return

    const updatedContributionByItemId = new Map()
    const diningIds = [...new Set(diningItems.map(diningItem => diningItem.dining_id).filter(Boolean))]

    for (const diningItem of diningItems) {
      const ingredient = ingredientById.get(String(diningItem.ingredient_id))
      const priceContribution = calcSyncedDiningCost(diningItem, ingredient, item.price)
      const { error } = await supabase.from('dining_items').update({
        name_zh: item.name_zh,
        category: item.category,
        unit: item.unit,
        memo: item.memo || null,
        price_contribution: priceContribution
      }).eq('id', diningItem.id)
      if (error) throw error
      updatedContributionByItemId.set(String(diningItem.id), priceContribution)
    }

    if (!diningIds.length) return

    const { data: allRecordItems, error: allRecordItemsError } = await supabase
      .from('dining_items')
      .select('id, dining_id, price_contribution')
      .in('dining_id', diningIds)

    if (allRecordItemsError) throw allRecordItemsError

    const costByDiningId = new Map(diningIds.map(diningId => [String(diningId), 0]))
    for (const diningItem of allRecordItems || []) {
      const diningId = String(diningItem.dining_id)
      const contribution = updatedContributionByItemId.has(String(diningItem.id))
        ? updatedContributionByItemId.get(String(diningItem.id))
        : (Number(diningItem.price_contribution) || 0)
      costByDiningId.set(diningId, (costByDiningId.get(diningId) || 0) + contribution)
    }

    for (const [diningId, homeCost] of costByDiningId.entries()) {
      const { error } = await supabase
        .from('dining_history')
        .update({ home_cost: Math.round(homeCost * 10) / 10 })
        .eq('id', diningId)
      if (error) throw error
    }
  }

  async function saveItemEdit(historyId, item) {
    setConfirm(null)
    const savedItem = {
      ...item,
      quantity: Number(item.quantity) || 1,
      price: normalizeOptionalNumber(item.price),
      original_price: normalizeOptionalNumber(item.original_price),
    }

    const { data: updatedItem, error: purchaseError } = await supabase.from('purchase_items').update({
      name_zh: savedItem.name_zh,
      name_original: savedItem.name_original,
      category: savedItem.category,
      quantity: savedItem.quantity,
      unit: savedItem.unit,
      price: savedItem.price,
      original_price: savedItem.original_price,
      is_discount: savedItem.is_discount,
      discount_info: savedItem.discount_info || null,
      expiry_date: savedItem.expiry_date || null,
      memo: savedItem.memo || null,
    }).eq('id', savedItem.id).select().single()
    if (purchaseError) {
      alert('保存购物履历失败：' + purchaseError.message)
      return
    }
    const syncedItem = updatedItem || savedItem

    if (syncToIngredients) {
      // 根据分类判断同步到哪个库存表
      const isDaily = isDailyCategory(syncedItem.category)
      const table = isDaily ? 'daily_items' : 'ingredients'
      const updateData = {
        name_zh: syncedItem.name_zh,
        category: syncedItem.category,
        quantity: Number(syncedItem.quantity) || 1,
        unit: syncedItem.unit,
        memo: syncedItem.memo || null,
      }
      if (!isDaily) {
        updateData.expiry_date = syncedItem.expiry_date || null
      }
      const { error: syncError } = await supabase
        .from(table)
        .update(updateData)
        .eq('purchase_item_id', syncedItem.id)
      if (syncError) {
        alert('同步到库存失败：' + syncError.message)
        return
      }
    }

    if (syncToDining) {
      try {
        await syncPurchaseItemToDining(syncedItem)
      } catch (error) {
        alert('同步到自炊履历失败：' + error.message)
        return
      }
    }

    setHistory(history.map(h => h.id === historyId
      ? { ...h, purchase_items: h.purchase_items.map(i => i.id === syncedItem.id ? syncedItem : i) }
      : h
    ))
    setEditingItem(null)
  }

  const filteredHistory = history.map(h => {
    // 日期过滤
    if (dateFilter) {
      const itemDate = h.purchased_at || h.created_at
      if (!itemDate || itemDate.slice(0, 10) !== dateFilter) return null
    }
    if (!search) return { ...h, matchedItems: null }
    const s = search.toLowerCase()
    const storeMatch =
      h.store_name?.toLowerCase().includes(s) ||
      h.store_name_original?.toLowerCase().includes(s) ||
      h.purchased_at?.includes(s)
    if (storeMatch) return { ...h, matchedItems: null }
    const matchedItems = h.purchase_items?.filter(i =>
      i.name_zh?.toLowerCase().includes(s) ||
      i.name_original?.toLowerCase().includes(s) ||
      i.memo?.toLowerCase().includes(s)
    )
    if (matchedItems?.length > 0) return { ...h, matchedItems }
    return null
  }).filter(Boolean)

  const groupedByYear = {}
  filteredHistory.forEach(h => {
    const dateStr = h.purchased_at || h.created_at
    const d = dateStr ? new Date(dateStr) : new Date()
    const yearKey = `${d.getFullYear()}年`
    const monthKey = `${d.getMonth() + 1}月`
    if (!groupedByYear[yearKey]) groupedByYear[yearKey] = {}
    if (!groupedByYear[yearKey][monthKey]) groupedByYear[yearKey][monthKey] = []
    groupedByYear[yearKey][monthKey].push(h)
  })

  const [mainTab, setMainTab] = useState('purchase')

  return (
    <div style={{ padding: 16 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 6, marginBottom: 16,
        background: '#f1f5f9', borderRadius: 12, padding: 4
      }}>
        {[['purchase','🧾 购物履历'],['dining','🍽️ 餐饮履历']].map(([id, label]) => (
          <button key={id} onClick={() => setMainTab(id)} style={{
            padding: '9px 0', borderRadius: 9, fontSize: 13, fontWeight: 600,
            background: mainTab === id ? '#fff' : 'transparent',
            color: mainTab === id ? (id === 'purchase' ? '#16a34a' : '#f97316') : '#94a3b8',
            boxShadow: mainTab === id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
          }}>{label}</button>
        ))}
      </div>

      {mainTab === 'dining' && <DiningHistory />}

      {mainTab === 'purchase' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700 }}>🧾 购物履历</h1>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>共 {history.length} 张小票</span>
            </div>
            <select
              value={settings.display_currency || 'JPY'}
              onChange={async e => await saveSetting('display_currency', e.target.value)}
              style={{ padding: '4px 8px', borderRadius: 7, fontSize: 12, border: '1px solid #e2e8f0', color: '#475569', background: '#fff' }}>
              {(settings.exchange_rates || []).map(r => (
                <option key={r.to} value={r.to}>{r.symbol} {r.to}</option>
              ))}
            </select>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <button onClick={() => setShowManualAdd(true)} style={{
              padding: '10px 0', borderRadius: 10, background: '#f0fdf4',
              color: '#16a34a', fontSize: 13, fontWeight: 600,
              border: '1.5px dashed #86efac',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3
            }}>
              <span style={{ fontSize: 20 }}>✏️</span>手动录入
            </button>
            <button onClick={() => setShowReceiptScan(true)} style={{
              padding: '10px 0', borderRadius: 10, background: '#f0fdf4',
              color: '#16a34a', fontSize: 13, fontWeight: 600,
              border: '1.5px dashed #86efac',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3
            }}>
              <span style={{ fontSize: 20 }}>📷</span>扫描小票
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <span style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                fontSize: 16, color: '#94a3b8', pointerEvents: 'none'
              }}>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="搜索商家、商品名称..."
                style={{
                  width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10, fontSize: 14,
                  border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff', boxSizing: 'border-box'
                }} />
              {search && (
                <button onClick={() => setSearch('')} style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', color: '#94a3b8', fontSize: 18, lineHeight: 1
                }}>×</button>
              )}
            </div>
            <label style={{ width: 42, flexShrink: 0, cursor: 'pointer', display: 'block', position: 'relative', overflow: 'hidden' }}>
              <span style={{
                width: 42, height: 42, borderRadius: 10, fontSize: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: dateFilter ? '1.5px solid #16a34a' : '1.5px solid #e2e8f0',
                background: dateFilter ? '#f0fdf4' : '#fff'
              }}>📅</span>
              <input type="date" value={dateFilter}
                onChange={e => { setDateFilter(e.target.value); setCollapsedYears({}); setCollapsedMonths({}) }}
                style={{ position: 'absolute', left: 0, top: 0, opacity: 0, width: 42, height: 42, fontSize: 16 }} />
            </label>
            {dateFilter && (
              <button onClick={() => setDateFilter('')}
                style={{
                  width: 42, flexShrink: 0, borderRadius: 10, fontSize: 14, fontWeight: 600,
                  border: '1.5px solid #fca5a5', background: '#fef2f2', color: '#dc2626', cursor: 'pointer'
                }}>✕</button>
            )}
          </div>
          
          {showReceiptScan && (
            <ReceiptScanModal
              onClose={() => setShowReceiptScan(false)}
              onSaved={fetchHistory}
            />
          )}
          {showManualAdd && (
            <ManualReceiptModal
              onClose={() => setShowManualAdd(false)}
              onSaved={fetchHistory}
            />
          )}
          
          {detailItem && <ItemDetailModal item={detailItem} onClose={() => setDetailItem(null)} />}
          {confirm && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 1000, padding: 24
            }}>
              <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 360 }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>{confirm.title}</div>
                {confirm.message && (
                  <div style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>{confirm.message}</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {confirm.onYes && (
                    <button onClick={confirm.onYes} style={{
                      padding: '11px 0', borderRadius: 10, background: '#ef4444',
                      color: '#fff', fontSize: 15, fontWeight: 700
                    }}>是，同步更新物品库存</button>
                  )}
                  {(confirm.onNo || confirm.onConfirm) && (
                    <button onClick={confirm.onNo || confirm.onConfirm} style={{
                      padding: '11px 0', borderRadius: 10, background: '#f1f5f9',
                      color: '#475569', fontSize: 15, fontWeight: 600
                    }}>{confirm.onYes ? '否，仅操作履历' : '确认删除'}</button>
                  )}
                  <button onClick={confirm.onCancel} style={{
                    padding: '11px 0', borderRadius: 10, background: '#fff',
                    color: '#94a3b8', fontSize: 14, border: '1px solid #e2e8f0'
                  }}>取消</button>
                </div>
              </div>
            </div>
          )}

          {editingHistory && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 999
            }}>
              <div style={{
                background: '#fff', borderRadius: '16px 16px 0 0', padding: 20,
                width: '100%', maxWidth: 430, maxHeight: '85vh', overflowY: 'auto'
              }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>编辑购物记录</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>商家名称（中文）</div>
                    <input style={smallField} value={editingHistory.store_name || ''}
                      onChange={e => setEditingHistory(h => ({ ...h, store_name: e.target.value }))} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>商家原文名称</div>
                    <input style={smallField} value={editingHistory.store_name_original || ''}
                      onChange={e => setEditingHistory(h => ({ ...h, store_name_original: e.target.value }))} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>购买日期</div>
                    <input style={smallField} type="date" value={editingHistory.purchased_at || ''}
                      onChange={e => setEditingHistory(h => ({ ...h, purchased_at: e.target.value }))} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>合计金额（¥）</div>
                    <input style={smallField} type="number" value={editingHistory.total_amount || ''}
                      onChange={e => setEditingHistory(h => ({ ...h, total_amount: e.target.value }))} />
                  </div>
                </div>
                <div style={{ marginTop: 4 }}>
                  <button onClick={() => {
                    setShowAddItems(!showAddItems)
                    if (!showAddItems && newItems.length === 0) {
                      setNewItems([{
                        name_zh: '', name_original: '', category: '', quantity: 1, unit: '个',
                        price: '', original_price: '', is_discount: false, discount_info: '',
                        expiry_date: '', memo: '', add_to_fridge: true, stock_type: 'food'
                      }])
                    }
                  }} style={{
                    width: '100%', padding: '8px 0', borderRadius: 9, fontSize: 13, fontWeight: 600,
                    background: '#f0fdf4', color: '#16a34a', border: '1px dashed #86efac'
                  }}>
                    {showAddItems ? '收起追加商品' : '+ 追加商品'}
                  </button>

                  {showAddItems && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {newItems.map((item, i) => (
                        <div key={i} style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px', border: '1.5px solid #e2e8f0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>商品 {i + 1}</div>
                            {newItems.length > 1 && (
                              <button onClick={() => setNewItems(items => items.filter((_, j) => j !== i))}
                                style={{ background: '#fef2f2', color: '#ef4444', fontSize: 12, padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>删除</button>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <input style={{ ...smallField, flex: 2 }} value={item.name_zh}
                                onChange={e => setNewItems(items => { const n=[...items]; n[i]={...n[i],name_zh:e.target.value}; return n })}
                                placeholder="商品名称（中文）" />
                              <input style={{ ...smallField, flex: 1 }} value={item.name_original}
                                onChange={e => setNewItems(items => { const n=[...items]; n[i]={...n[i],name_original:e.target.value}; return n })}
                                placeholder="原文" />
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <input style={{ ...smallField, flex: 1, textAlign: 'center' }} type="number"
                                value={item.quantity}
                                onChange={e => setNewItems(items => { const n=[...items]; n[i]={...n[i],quantity:e.target.value}; return n })} />
                              <select style={{ ...smallField, flex: 1 }} value={item.unit}
                                onChange={e => setNewItems(items => { const n=[...items]; n[i]={...n[i],unit:e.target.value}; return n })}>
                                {UNITS.map(u => <option key={u}>{u}</option>)}
                              </select>
                              <select style={{ ...smallField, flex: 2 }} value={item.category}
                                onChange={e => setNewItems(items => { const n=[...items]; n[i]={...n[i],category:e.target.value}; return n })}>
                                <option value="">分类</option>
                                <optgroup label="食用品">
                                  {FOOD_CATS.map(c => <option key={c}>{c}</option>)}
                                </optgroup>
                                <optgroup label="非食用品">
                                  {DAILY_CATS.map(c => <option key={c}>{c}</option>)}
                                </optgroup>
                                <option value="非食材">非食材</option>
                              </select>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>实付价格</div>
                                <input style={smallField} type="number" value={item.price}
                                  onChange={e => setNewItems(items => { const n=[...items]; n[i]={...n[i],price:e.target.value}; return n })} placeholder="¥" />
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>原价</div>
                                <input style={smallField} type="number" value={item.original_price}
                                  onChange={e => setNewItems(items => { const n=[...items]; n[i]={...n[i],original_price:e.target.value}; return n })} placeholder="¥" />
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input type="checkbox" checked={item.is_discount}
                                onChange={e => setNewItems(items => { const n=[...items]; n[i]={...n[i],is_discount:e.target.checked}; return n })}
                                style={{ width: 14, height: 14, accentColor: '#ef4444' }} />
                              <span style={{ fontSize: 12, color: '#475569' }}>折扣商品</span>
                              {item.is_discount && (
                                <input style={{ ...smallField, flex: 1 }} value={item.discount_info}
                                  onChange={e => setNewItems(items => { const n=[...items]; n[i]={...n[i],discount_info:e.target.value}; return n })}
                                  placeholder="折扣说明" />
                              )}
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>过期日期</div>
                              <input style={smallField} type="date" value={item.expiry_date}
                                onChange={e => setNewItems(items => { const n=[...items]; n[i]={...n[i],expiry_date:e.target.value}; return n })} />
                            </div>
                            <input style={smallField} value={item.memo}
                              onChange={e => setNewItems(items => { const n=[...items]; n[i]={...n[i],memo:e.target.value}; return n })}
                              placeholder="备注（可选）" />
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <input type="checkbox" checked={item.add_to_fridge}
                                onChange={e => setNewItems(items => { const n=[...items]; n[i]={...n[i],add_to_fridge:e.target.checked}; return n })}
                                style={{ width: 14, height: 14, accentColor: '#16a34a' }} />
                              <span style={{ fontSize: 12, color: '#475569' }}>入库</span>
                              {item.add_to_fridge && (
                                <div style={{ display: 'flex', gap: 5 }}>
                                  {[['food','食用品'],['daily','非食用品']].map(([v, l]) => (
                                    <button key={v} onClick={() => setNewItems(items => { const n=[...items]; n[i]={...n[i],stock_type:v}; return n })} style={{
                                      padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                      background: (item.stock_type || 'food') === v ? (v === 'food' ? '#16a34a' : '#3b82f6') : '#f1f5f9',
                                      color: (item.stock_type || 'food') === v ? '#fff' : '#94a3b8'
                                    }}>{l}</button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      <button onClick={() => setNewItems(i => [...i, {
                        name_zh: '', name_original: '', category: '', quantity: 1, unit: '个',
                        price: '', original_price: '', is_discount: false, discount_info: '',
                        expiry_date: '', memo: '', add_to_fridge: true, stock_type: 'food'
                      }])} style={{
                        width: '100%', padding: '8px 0', borderRadius: 9,
                        background: '#f1f5f9', color: '#475569', fontSize: 13, fontWeight: 600
                      }}>+ 再添加一件</button>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button onClick={() => { setEditingHistory(null); setShowAddItems(false); setNewItems([]) }} style={{
                    flex: 1, padding: '11px 0', borderRadius: 10,
                    background: '#f1f5f9', color: '#475569', fontSize: 14, fontWeight: 600
                  }}>取消</button>
                  <button onClick={saveHistoryEdit} style={{
                    flex: 2, padding: '11px 0', borderRadius: 10,
                    background: '#16a34a', color: '#fff', fontSize: 14, fontWeight: 700
                  }}>保存</button>
                </div>
              </div>
            </div>
          )}

          {editingItem && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 999
            }}>
              <div style={{
                background: '#fff', borderRadius: '16px 16px 0 0', padding: 20,
                width: '100%', maxWidth: 430, maxHeight: '85vh', overflowY: 'auto'
              }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>编辑商品</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>中文名称</div>
                    <input style={smallField} value={editingItem.item.name_zh}
                      onChange={e => setEditingItem(ei => ({ ...ei, item: { ...ei.item, name_zh: e.target.value } }))} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>原文名称</div>
                    <input style={smallField} value={editingItem.item.name_original || ''}
                      onChange={e => setEditingItem(ei => ({ ...ei, item: { ...ei.item, name_original: e.target.value } }))} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>数量</div>
                      <input style={smallField} type="number" value={editingItem.item.quantity}
                        onChange={e => setEditingItem(ei => ({ ...ei, item: { ...ei.item, quantity: e.target.value } }))} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>单位</div>
                      <select style={smallField} value={editingItem.item.unit || '个'}
                        onChange={e => setEditingItem(ei => ({ ...ei, item: { ...ei.item, unit: e.target.value } }))}>
                        {UNITS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>分类</div>
                    <select style={smallField} value={editingItem.item.category || ''}
                      onChange={e => setEditingItem(ei => ({ ...ei, item: { ...ei.item, category: e.target.value } }))}>
                      <option value="">分类</option>
                      <optgroup label="食用品">
                        {FOOD_CATS.map(c => <option key={c}>{c}</option>)}
                      </optgroup>
                      <optgroup label="非食用品">
                        {DAILY_CATS.map(c => <option key={c}>{c}</option>)}
                      </optgroup>
                      <option value="非食材">非食材（不入库）</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>实付价格</div>
                      <input style={smallField} type="number" value={editingItem.item.price || ''}
                        onChange={e => setEditingItem(ei => ({ ...ei, item: { ...ei.item, price: e.target.value } }))} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>原价</div>
                      <input style={smallField} type="number" value={editingItem.item.original_price || ''}
                        onChange={e => setEditingItem(ei => ({ ...ei, item: { ...ei.item, original_price: e.target.value } }))} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" id="is-discount" checked={editingItem.item.is_discount || false}
                      onChange={e => setEditingItem(ei => ({ ...ei, item: { ...ei.item, is_discount: e.target.checked } }))}
                      style={{ width: 16, height: 16, accentColor: '#16a34a' }} />
                    <label htmlFor="is-discount" style={{ fontSize: 14, color: '#475569' }}>折扣商品</label>
                  </div>
                  {editingItem.item.is_discount && (
                    <div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>折扣说明</div>
                      <input style={smallField} value={editingItem.item.discount_info || ''}
                        onChange={e => setEditingItem(ei => ({ ...ei, item: { ...ei.item, discount_info: e.target.value } }))} />
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>备注</div>
                    <input style={smallField} value={editingItem.item.memo || ''}
                      onChange={e => setEditingItem(ei => ({ ...ei, item: { ...ei.item, memo: e.target.value } }))}
                      placeholder="可选" />
                  </div>
                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 10, marginTop: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8 }}>保质期信息</div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>生产日期</div>
                        <input style={smallField} type="date" value={editingItem.item.mfg_date || ''}
                          onChange={e => {
                            const v = e.target.value
                            setEditingItem(ei => {
                              const shelf = ei.item.shelf_days
                              const expiry = v && shelf ? calcExpiry(v, shelf) : ei.item.expiry_date
                              return { ...ei, item: { ...ei.item, mfg_date: v, expiry_date: expiry } }
                            })
                          }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>保质期（天）</div>
                        <input style={smallField} type="number" placeholder="如：180"
                          value={editingItem.item.shelf_days || ''}
                          onChange={e => {
                            const v = e.target.value
                            setEditingItem(ei => {
                              const mfg = ei.item.mfg_date
                              const expiry = mfg && v ? calcExpiry(mfg, v) : ei.item.expiry_date
                              return { ...ei, item: { ...ei.item, shelf_days: v, expiry_date: expiry } }
                            })
                          }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>过期日期</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input style={{ ...smallField, flex: 1, minWidth: 0 }} type="date" value={editingItem.item.expiry_date || ''}
                          onChange={e => setEditingItem(ei => ({ ...ei, item: { ...ei.item, expiry_date: e.target.value } }))} />
                        <button type="button" onClick={() => setEditingItem(ei => ({ ...ei, item: { ...ei.item, expiry_date: '' } }))}
                          disabled={!editingItem.item.expiry_date}
                          style={{ padding: '6px 10px', borderRadius: 7, background: editingItem.item.expiry_date ? '#f1f5f9' : '#f8fafc', color: editingItem.item.expiry_date ? '#475569' : '#cbd5e1', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                          清除
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#475569' }}>
                  <input type="checkbox" checked={syncToIngredients} onChange={e => setSyncToIngredients(e.target.checked)}
                    style={{ width: 14, height: 14, accentColor: '#16a34a' }} />
                  同步到物品库存
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#475569' }}>
                  <input type="checkbox" checked={syncToDining} onChange={e => setSyncToDining(e.target.checked)}
                    style={{ width: 14, height: 14, accentColor: '#16a34a' }} />
                  同步到自炊履历
                </label>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button onClick={() => setEditingItem(null)} style={{
                    flex: 1, padding: '11px 0', borderRadius: 10,
                    background: '#f1f5f9', color: '#475569', fontSize: 14, fontWeight: 600
                  }}>取消</button>
                  <button onClick={() => confirmSaveItem(editingItem.item)} style={{
                    flex: 2, padding: '11px 0', borderRadius: 10,
                    background: '#16a34a', color: '#fff', fontSize: 14, fontWeight: 700
                  }}>保存</button>
                </div>
                {/* 重新入库按钮 */}
                {editingItem.item.category !== '非食材' && (
                  <button onClick={async () => {
                    await restockItem(editingItem.item)
                    fetchHistory()
                    setEditingItem(null)
                  }} style={{
                    width: '100%', marginTop: 8, padding: '11px 0', borderRadius: 10,
                    background: isDailyCategory(editingItem.item.category) ? '#eff6ff' : '#f0fdf4',
                    color: isDailyCategory(editingItem.item.category) ? '#3b82f6' : '#16a34a',
                    fontSize: 14, fontWeight: 600,
                    border: `1.5px solid ${isDailyCategory(editingItem.item.category) ? '#bfdbfe' : '#bbf7d0'}`
                  }}>
                    🔄 重新入库到{isDailyCategory(editingItem.item.category) ? '非食用品' : '食用品'}
                  </button>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>加载中...</p>
          ) : filteredHistory.length === 0 ? (
            <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>
              {search ? '没有找到匹配的记录' : '暂无购物记录'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {(() => {
                const now = new Date()
                const currentYear = `${now.getFullYear()}年`
                const currentMonth = `${now.getMonth() + 1}月`
                const isFiltering = !!(search || dateFilter)
                const allMonthKeys = []
                Object.entries(groupedByYear).sort(([a], [b]) => b.localeCompare(a)).forEach(([year, months]) => {
                  Object.keys(months).sort((a, b) => Number(b.replace('月','')) - Number(a.replace('月',''))).forEach(m => allMonthKeys.push(m))
                })
                const latestMonth = allMonthKeys.length > 0 ? allMonthKeys[0] : currentMonth
                return Object.entries(groupedByYear).map(([year, months]) => {
                  const yearTotal = Object.values(months).flat().reduce((sum, h) => sum + (Number(h.total_amount) || 0), 0)
                  const yearCount = Object.values(months).flat().length
                  const isYearCollapsed = collapsedYears[year] ?? (!isFiltering && year !== currentYear)

                  return (
                    <div key={year} style={{ border: '1px solid #f1f5f9', borderRadius: 12, overflow: 'hidden' }}>
                      <div onClick={() => setCollapsedYears(c => ({ ...c, [year]: !c[year] }))}
                        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f8fafc' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: '#334155' }}>{year}</span>
                          <span style={{ fontSize: 12, color: '#94a3b8' }}>{yearCount} 张小票</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {yearTotal > 0 && (
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#16a34a' }}>{formatAmount(yearTotal, settings)}</span>
                          )}
                          <span style={{ fontSize: 14, color: '#94a3b8' }}>{isYearCollapsed ? '▼' : '▲'}</span>
                        </div>
                      </div>

                      {!isYearCollapsed && (
                        <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {Object.entries(months).map(([month, items]) => {
                            const monthTotal = items.reduce((sum, h) => sum + (Number(h.total_amount) || 0), 0)
                            const monthKey = `${year}-${month}`
                            const isMonthCollapsed = collapsedMonths[monthKey] ?? (month !== latestMonth && !isFiltering)

                            return (
                              <div key={month}>
                                <div onClick={() => setCollapsedMonths(c => ({ ...c, [monthKey]: !c[monthKey] }))}
                                  style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isMonthCollapsed ? 0 : 8, paddingBottom: 6, borderBottom: '1.5px solid #f1f5f9' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>{month}</span>
                                    <span style={{ fontSize: 12, color: '#94a3b8' }}>{items.length} 张小票</span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    {monthTotal > 0 && (
                                      <span style={{ fontSize: 13, fontWeight: 600, color: '#16a34a' }}>{formatAmount(monthTotal, settings)}</span>
                                    )}
                                    <span style={{ fontSize: 13, color: '#94a3b8' }}>{isMonthCollapsed ? '▼' : '▲'}</span>
                                  </div>
                                </div>

                                {!isMonthCollapsed && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {items.map(h => {
                                      const displayItems = h.matchedItems || h.purchase_items || []
                                      const isExpanded = expanded[h.id] || (search && h.matchedItems)
                                      const consumedCount = displayItems.filter(i => i.is_fully_consumed).length

                                      return (
                                        <div key={h.id} style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                                          <div style={{ padding: '12px 14px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                              <div onClick={() => setExpanded(e => ({ ...e, [h.id]: !e[h.id] }))} style={{ flex: 1, cursor: 'pointer' }}>
                                                <div style={{ fontWeight: 600, fontSize: 15 }}>{h.store_name || '未知商家'}</div>
                                                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                                                  {h.purchased_at || h.created_at?.split('T')[0]}，{displayItems.length} 件商品
                                                  {search && h.matchedItems && (
                                                    <span style={{ color: '#16a34a', marginLeft: 6 }}>{h.matchedItems.length} 件匹配</span>
                                                  )}
                                                </div>
                                                {consumedCount > 0 && (
                                                  <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>{consumedCount} 件已使用</div>
                                                )}
                                              </div>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                                {h.total_amount && (
                                                  <div style={{ fontWeight: 700, color: '#16a34a' }}>{formatAmount(h.total_amount, settings)}</div>
                                                )}
                                                <button onClick={() => setEditingHistory({ ...h })} style={{ background: '#f1f5f9', color: '#475569', fontSize: 13, padding: '5px 10px', borderRadius: 7, fontWeight: 600 }}>编辑</button>
                                                <button onClick={() => confirmDeleteHistory(h)} style={{ background: '#fef2f2', color: '#ef4444', fontSize: 13, padding: '5px 10px', borderRadius: 7, fontWeight: 600 }}>删除</button>
                                                <div onClick={() => setExpanded(e => ({ ...e, [h.id]: !e[h.id] }))} style={{ fontSize: 16, color: '#94a3b8', cursor: 'pointer', padding: '0 4px' }}>
                                                  {isExpanded ? '▲' : '▼'}
                                                </div>
                                              </div>
                                            </div>
                                          </div>

                                          {isExpanded && (
                                            <div style={{ borderTop: '1px solid #f1f5f9' }}>
                                              {displayItems.map(item => {
                                                const isConsumed = item.is_fully_consumed
                                                return (
                                                  <div key={item.id} onClick={() => setDetailItem(item)} style={{
                                                    padding: '10px 14px', borderBottom: '1px solid #f8fafc',
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                                                    opacity: isConsumed ? 0.6 : 1, cursor: 'pointer'
                                                  }}>
                                                    <div style={{ flex: 1 }}>
                                                      <div style={{ fontSize: 14, fontWeight: 500, color: item.category === '非食材' ? '#94a3b8' : '#1e293b' }}>
                                                        {item.name_zh}
                                                        {item.add_to_fridge && !isConsumed && (
                                                          <span style={{ fontSize: 11, color: isDailyCategory(item.category) ? '#3b82f6' : '#16a34a', marginLeft: 6 }}>已入库</span>
                                                        )}
                                                        {isConsumed && (
                                                          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>
                                                            {isDailyCategory(item.category) ? '已用完' : '已食用'}
                                                          </span>
                                                        )}
                                                      </div>
                                                      {item.name_original && <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.name_original}</div>}
                                                      {item.discount_info && <div style={{ fontSize: 11, color: '#ef4444' }}>{item.discount_info}</div>}
                                                      {item.memo && <div style={{ fontSize: 11, color: '#64748b' }}>备注：{item.memo}</div>}
                                                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                                                        {item.quantity}{item.unit}
                                                        {item.price && (
                                                          <span style={{ marginLeft: 6, color: item.is_discount ? '#ef4444' : '#475569', fontWeight: 600 }}>
                                                            {formatAmount(item.price, settings)}
                                                            {item.is_discount && item.original_price && (
                                                              <span style={{ textDecoration: 'line-through', color: '#94a3b8', fontSize: 11, marginLeft: 4 }}>{formatAmount(item.original_price, settings)}</span>
                                                            )}
                                                          </span>
                                                        )}
                                                        {item.expiry_date && <span style={{ marginLeft: 6, color: '#94a3b8' }}>到期 {item.expiry_date}</span>}
                                                      </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                                      <button onClick={e => { e.stopPropagation(); setEditingItem({ historyId: h.id, item: { ...item, mfg_date: item.mfg_date || '', shelf_days: item.shelf_days || '' }, original_name_zh: item.name_zh }) }} style={{ background: '#f1f5f9', color: '#475569', fontSize: 13, padding: '5px 10px', borderRadius: 7, fontWeight: 600 }}>编辑</button>
                                                      <button onClick={e => { e.stopPropagation(); confirmDeleteItem(h.id, item) }} style={{ background: '#fef2f2', color: '#ef4444', fontSize: 13, padding: '5px 10px', borderRadius: 7, fontWeight: 600 }}>删除</button>
                                                    </div>
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
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}