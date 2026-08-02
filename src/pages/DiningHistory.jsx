import { useEffect, useState, useCallback } from 'react'
import { supabase, batchFetchIn } from '../lib/supabase'
import { uploadPhoto, deletePhoto } from '../lib/imageUtils'
import PhotoViewer from '../components/PhotoViewer'
import ConfirmModal from '../components/ConfirmModal'
import { useSettings } from '../context/SettingsContext'
import { formatAmount } from '../lib/currency'

function IngredientPicker({ dinedAt, selected, setSelected, ingredients, loading }) {
  const [activeIngredientId, setActiveIngredientId] = useState(null)
  const [ingSearch, setIngSearch] = useState('')
  const [ingFilterStatus, setIngFilterStatus] = useState('active')
  const[ingFilterCategory, setIngFilterCategory] = useState('')
  const [ingFilterStore, setIngFilterStore] = useState('')
  const[ingFilterDate, setIngFilterDate] = useState('')
  const [ingPage, setIngPage] = useState(0)
  const { settings } = useSettings()
  const diningQtyStep = Math.min(10, Math.max(0.01, Number(settings.dining_qty_step) || 1))
  const QUICK_STEPS = [0.01, 0.1, 1, 5, 10]
  const [activeQtyStep, setActiveQtyStep] = useState(diningQtyStep)
  const PAGE_SIZE = 8

  const smallField = {
    width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13,
    border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
  }

  const stores =[...new Set(ingredients.map(i => i.purchase_item?.purchase_history?.store_name).filter(Boolean))]
  const categories =[...new Set(ingredients.map(i => i.category).filter(Boolean))]

  const now = new Date(dinedAt)
  const dateRanges = {
    '3d': new Date(now.getTime() - 3 * 86400000).toISOString().split('T')[0],
    '7d': new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0],
    '30d': new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0],
  }

  const filteredIng = ingredients.filter(i => {
    const remaining = getIngredientRemaining(i)
    if (ingFilterStatus === 'active' && remaining <= 0) return false
    if (ingFilterStatus === 'consumed' && remaining > 0) return false
    if (ingFilterCategory && i.category !== ingFilterCategory) return false
    if (ingFilterStore && i.purchase_item?.purchase_history?.store_name !== ingFilterStore) return false
    const purchasedAt = i.purchase_item?.purchase_history?.purchased_at
    if (ingFilterDate && (!purchasedAt || purchasedAt < dateRanges[ingFilterDate])) return false
    if (ingSearch && !i.name_zh?.toLowerCase().includes(ingSearch.toLowerCase()) && !i.name_original?.toLowerCase().includes(ingSearch.toLowerCase())) return false
    return true
  })

  const totalPages = Math.ceil(filteredIng.length / PAGE_SIZE)
  const pagedIng = filteredIng.slice(ingPage * PAGE_SIZE, (ingPage + 1) * PAGE_SIZE)

  function calcCost(ing, qty) {
    const price = ing.purchase_item?.price
    if (!price || !qty) return 0
    return Math.round((price * qty / (ing.quantity || 1)) * 10) / 10
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        <input value={ingSearch} onChange={e => { setIngSearch(e.target.value); setIngPage(0) }}
          placeholder="搜索食材..."
          style={{ ...smallField }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <select style={{ ...smallField, flex: 1 }} value={ingFilterStatus}
            onChange={e => { setIngFilterStatus(e.target.value); setIngPage(0) }}>
            <option value="active">未食用完</option>
            <option value="consumed">已食用完</option>
            <option value="all">全部</option>
          </select>
          <select style={{ ...smallField, flex: 1 }} value={ingFilterCategory}
            onChange={e => { setIngFilterCategory(e.target.value); setIngPage(0) }}>
            <option value="">全部分类</option>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select style={{ ...smallField, flex: 1 }} value={ingFilterStore}
            onChange={e => { setIngFilterStore(e.target.value); setIngPage(0) }}>
            <option value="">全部商家</option>
            {stores.map(s => <option key={s}>{s}</option>)}
          </select>
          <select style={{ ...smallField, flex: 1 }} value={ingFilterDate}
            onChange={e => { setIngFilterDate(e.target.value); setIngPage(0) }}>
            <option value="">全部日期</option>
            <option value="3d">小票近3天</option>
            <option value="7d">小票近一周</option>
            <option value="30d">小票近一个月</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#64748b' }}>步长</span>
        {QUICK_STEPS.map(step => (
          <button key={step} onClick={() => {
            setActiveQtyStep(step)
            if (!activeIngredientId) return
            setSelected(s => {
              if (!s[activeIngredientId]) return s
              const ing = findIngredientById(ingredients, activeIngredientId)
              return {
                ...s,
                [activeIngredientId]: { ...s[activeIngredientId], qty: ing ? clampIngredientQty(ing, step, 0.01) : step }
              }
            })
          }} disabled={filteredIng.every(ing => getIngredientSelectableLimit(ing) < step)}
            style={{
              padding: '3px 8px',
              borderRadius: 999,
              fontSize: 12,
              border: `1px solid ${activeQtyStep === step ? '#16a34a' : '#cbd5e1'}`,
              background: filteredIng.every(ing => getIngredientSelectableLimit(ing) < step) ? '#f1f5f9' : (activeQtyStep === step ? '#dcfce7' : '#fff'),
              color: filteredIng.every(ing => getIngredientSelectableLimit(ing) < step) ? '#94a3b8' : (activeQtyStep === step ? '#166534' : '#475569'),
              cursor: filteredIng.every(ing => getIngredientSelectableLimit(ing) < step) ? 'not-allowed' : 'pointer',
              opacity: filteredIng.every(ing => getIngredientSelectableLimit(ing) < step) ? 0.7 : 1
            }}>
            {step}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#94a3b8', fontSize: 13 }}>加载中...</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pagedIng.length === 0 && (
              <div style={{ textAlign: 'center', padding: '16px 0', color: '#94a3b8', fontSize: 13 }}>没有符合条件的食材</div>
            )}
            {pagedIng.map(ing => {
              const remaining = getIngredientRemaining(ing)
              const selectableLimit = getIngredientSelectableLimit(ing)
              const isSelected = !!selected[ing.id]
              const sel = selected[ing.id]
              const cost = isSelected ? calcCost(ing, sel?.qty ?? 1) : 0
              const storeName = ing.purchase_item?.purchase_history?.store_name
              const purchasedAt = ing.purchase_item?.purchase_history?.purchased_at

              return (
                <div key={ing.id} style={{
                  background: isSelected ? '#f0fdf4' : '#f8fafc',
                  border: `1.5px solid ${isSelected ? '#16a34a' : '#e2e8f0'}`,
                  borderRadius: 10, padding: '9px 11px'
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div onClick={() => {
                      setSelected(s => {
                        if (s[ing.id]) { const n = { ...s }; delete n[ing.id]; if (String(activeIngredientId) === String(ing.id)) setActiveIngredientId(null); return n }
                        setActiveIngredientId(ing.id)
                        return { ...s,[ing.id]: { qty: clampIngredientQty(ing, activeQtyStep, 0.01), updateConsumed: false } }
                      })
                    }} style={{
                      width: 20, height: 20, borderRadius: 5, flexShrink: 0, marginTop: 2, cursor: 'pointer',
                      border: `2px solid ${isSelected ? '#16a34a' : '#cbd5e1'}`,
                      background: isSelected ? '#16a34a' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      {isSelected && <span style={{ color: '#fff', fontSize: 12 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{ing.name_zh}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                        {ing.category && `${ing.category} · `}
                        剩余 {remaining}{ing.unit}
                        {ing.purchase_item?.price && ` · ¥${ing.purchase_item.price}`}
                      </div>
                      {(storeName || purchasedAt) && (
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>
                          {storeName && `🏪 ${storeName}`}
                          {purchasedAt && ` · 📅 ${purchasedAt}`}
                        </div>
                      )}
                      {isSelected && (
                        <div onClick={() => setActiveIngredientId(ing.id)} style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <div style={{ fontSize: 11, color: String(activeIngredientId) === String(ing.id) ? '#16a34a' : '#94a3b8' }}>
                            {String(activeIngredientId) === String(ing.id) ? '当前步长应用对象' : '点击此区域设为步长应用对象'}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button onClick={() => setSelected(s => ({ ...s, [ing.id]: { ...s[ing.id], qty: clampIngredientQty(ing, parseFloat(((s[ing.id]?.qty || 1) - activeQtyStep).toFixed(2)), 0.01) } }))}
                              style={{ width: 24, height: 24, borderRadius: 6, background: '#f1f5f9', color: '#475569', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                            <input type="number" step={activeQtyStep} max={selectableLimit} value={sel?.qty ?? 1}
                              onChange={e => setSelected(s => ({ ...s, [ing.id]: { ...s[ing.id], qty: clampIngredientQty(ing, e.target.value, 0) } }))}
                              style={{ width: 55, textAlign: 'center', padding: '3px 6px', borderRadius: 6, border: '1.5px solid #e2e8f0', fontSize: 13, outline: 'none' }} />
                            <span style={{ fontSize: 12, color: '#475569' }}>{ing.unit}</span>
                            <button onClick={() => setSelected(s => ({ ...s, [ing.id]: { ...s[ing.id], qty: clampIngredientQty(ing, parseFloat(((s[ing.id]?.qty || 1) + activeQtyStep).toFixed(2)), 0.01) } }))}
                              style={{ width: 24, height: 24, borderRadius: 6, background: '#f1f5f9', color: '#475569', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                            {cost > 0 && <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>¥{cost.toFixed(1)}</span>}
                          </div>
                          {remaining > 0 && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, color: '#475569' }}>
                              <input type="checkbox" checked={sel?.updateConsumed || false}
                                onChange={e => setSelected(s => ({ ...s,[ing.id]: { ...s[ing.id], updateConsumed: e.target.checked } }))}
                                style={{ width: 13, height: 13, accentColor: '#16a34a' }} />
                              同步更新食用量
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <button onClick={() => setIngPage(p => Math.max(0, p - 1))} disabled={ingPage === 0}
                style={{ padding: '5px 10px', borderRadius: 7, background: '#f1f5f9', color: ingPage === 0 ? '#cbd5e1' : '#475569', fontSize: 12 }}>← 上页</button>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{ingPage + 1}/{totalPages}（{filteredIng.length} 件）</span>
              <button onClick={() => setIngPage(p => Math.min(totalPages - 1, p + 1))} disabled={ingPage >= totalPages - 1}
                style={{ padding: '5px 10px', borderRadius: 7, background: '#f1f5f9', color: ingPage >= totalPages - 1 ? '#cbd5e1' : '#475569', fontSize: 12 }}>下页 →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const MEAL_TIMES =[
  { id: 'breakfast', label: '早餐', icon: '🌅' },
  { id: 'lunch', label: '午餐', icon: '☀️' },
  { id: 'dinner', label: '晚餐', icon: '🌙' },
  { id: 'snack', label: '点心', icon: '🍪' },
]
const mealOrder = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 }
const mealLabel = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '点心' }
const mealIcon = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍪' }

function isSameId(a, b) {
  return a != null && b != null && String(a) === String(b)
}

function findIngredientById(ingredients, id) {
  return ingredients.find(i => isSameId(i.id, id))
}

function getIngredientRemaining(ingredient) {
  const remaining = (Number(ingredient?.quantity) || 0) - (Number(ingredient?.consumed_quantity) || 0)
  return Math.max(0, parseFloat(remaining.toFixed(2)))
}

function getIngredientSelectableLimit(ingredient) {
  const remaining = getIngredientRemaining(ingredient)
  return remaining > 0 ? remaining : (Number(ingredient?.quantity) || 1)
}

function clampIngredientQty(ingredient, qty, min = 0) {
  const limit = getIngredientSelectableLimit(ingredient)
  return Math.min(limit, Math.max(min, Number(qty) || 0))
}

async function fetchIngredientsByIds(ids) {
  if (ids.length === 0) return []
  return batchFetchIn('ingredients', 'id', ids, '*')
}

async function hydrateLatestPurchasePrices(ingredients) {
  const purchaseItemIds = [...new Set((ingredients || []).map(i => i.purchase_item_id).filter(Boolean))]
  if (!purchaseItemIds.length) return ingredients || []

  const data = await batchFetchIn('purchase_items', 'id', purchaseItemIds, `
    id,
    price,
    original_price,
    purchase_history:history_id(store_name, purchased_at)
  `)

  const purchaseItemById = new Map((data || []).map(item => [String(item.id), item]))
  return (ingredients || []).map(ingredient => {
    const latestPurchaseItem = purchaseItemById.get(String(ingredient.purchase_item_id))
    if (!latestPurchaseItem) return ingredient
    return {
      ...ingredient,
      purchase_item: {
        ...(ingredient.purchase_item || {}),
        ...latestPurchaseItem,
      }
    }
  })
}

function getDiningItemConsumedQty(item) {
  return Number(item?.consumed_quantity || item?.quantity) || 0
}

function formatDiningItemQty(item) {
  return `${getDiningItemConsumedQty(item)}${item?.unit || ''}`
}

const smallField = {
  width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13,
  border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
}
const field = {
  width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 15,
  border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
}

function calcIngredientCost(ingredient, consumedQty) {
  const price = ingredient.purchase_item?.price
  const totalQty = ingredient.quantity || 1
  if (!price || !consumedQty) return 0
  return Math.round((price * consumedQty / totalQty) * 10) / 10
}

function hasLivePurchasePrice(item) {
  return Boolean(item?.ingredient?.purchase_item)
}

function getDiningItemCost(item) {
  if (hasLivePurchasePrice(item)) {
    return calcIngredientCost(item.ingredient, getDiningItemConsumedQty(item))
  }

  return Number(item?.price_contribution) || 0
}

function getDiningRecordHomeCost(record) {
  const items = record?.dining_items || []
  const itemCost = items.reduce((sum, item) => sum + getDiningItemCost(item), 0)
  if (items.some(hasLivePurchasePrice) || itemCost > 0) return itemCost

  return Number(record?.home_cost) || 0
}

function DishDetailModal({ item, diningId, photos, onAddPhotos, onDeletePhoto, uploading, onClose, onSaveMemo }) {
  const[memo, setMemo] = useState(item.memo || '')
  const [saving, setSaving] = useState(false)
  const itemPhotos = photos[`${diningId}-item-${item.id}`] ||[]

  async function save() {
    setSaving(true)
    await supabase.from('dining_items').update({ memo: memo || null }).eq('id', item.id)
    onSaveMemo(item.id, memo)
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{item.name_zh}</div>
          <button onClick={onClose} style={{ background: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
          {item.name_original && <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 4 }}>{item.name_original}</div>}
          <div style={{ fontSize: 14, color: '#475569' }}>
            {item.consumed_quantity || item.quantity}{item.unit}
            {getDiningItemCost(item) > 0 && (
              <span style={{ marginLeft: 8, fontWeight: 600, color: '#16a34a' }}>成本 ¥{getDiningItemCost(item).toFixed(1)}</span>
            )}
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>备注</div>
          <textarea value={memo} onChange={e => setMemo(e.target.value)} placeholder="添加备注..." rows={3}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 14, border: '1.5px solid #e2e8f0', outline: 'none', resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <button onClick={save} disabled={saving} style={{ marginTop: 8, padding: '8px 16px', borderRadius: 8, background: '#f97316', color: '#fff', fontSize: 13, fontWeight: 600 }}>
            {saving ? '保存中...' : '保存备注'}
          </button>
        </div>
        <div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>菜品照片（{itemPhotos.length} 张）</div>
          <PhotoViewer photos={itemPhotos} onAdd={files => onAddPhotos(files, diningId, item.id)} onDelete={onDeletePhoto} uploading={uploading} />
        </div>
      </div>
    </div>
  )
}

function EditDiningModal({ record, onClose, onSaved }) {
  const { settings } = useSettings()
  const diningQtyStep = Math.min(10, Math.max(0.01, Number(settings.dining_qty_step) || 1))
  const QUICK_STEPS = [0.01, 0.1, 1, 5, 10]
  const [activeQtyStep, setActiveQtyStep] = useState(diningQtyStep)
  const [header, setHeader] = useState({
    meal_time: record.meal_time || null,
    dined_at: record.dined_at,
    dined_time: record.dined_time || '',
    store_name: record.store_name || '',
    store_name_original: record.store_name_original || '',
    amount: record.amount || '',
    memo: record.memo || ''
  })
  const [items, setItems] = useState(
    (record.dining_items ||[]).map(i => ({ ...i, price: i.price || '', qty_edit: i.consumed_quantity || i.quantity || 1 }))
  )
  const [activeEditItemIndex, setActiveEditItemIndex] = useState(items.length ? 0 : null)
  const[saving, setSaving] = useState(false)
  const[showAddMore, setShowAddMore] = useState(false)
  const [ingredients, setIngredients] = useState([])
  const[addSelected, setAddSelected] = useState({})
  const [pendingConfirm, setPendingConfirm] = useState(null)

  useEffect(() => {
    if (record.dining_type === 'home') fetchIngredients()
  },[record.dining_type, record.dined_at])

  useEffect(() => {
    setActiveEditItemIndex(currentIndex => {
      if (items.length === 0) return null
      if (currentIndex === null || currentIndex >= items.length) return 0
      return currentIndex
    })
  }, [items.length])

  async function fetchIngredients() {
    const { data } = await supabase
      .from('ingredients')
      .select(`
        *,
        purchase_item:purchase_item_id(
          price,
          purchase_history:history_id(store_name, purchased_at)
        )
      `)
      .order('created_at', { ascending: false })
    setIngredients(await hydrateLatestPurchasePrices(data || []))
  }

  function calcCost(ing, qty) {
    if (!ing) return 0;
    const price = ing.purchase_item?.price
    if (!price || !qty) return 0
    return Math.round((price * qty / (ing.quantity || 1)) * 10) / 10
  }

  async function rollbackRemovedConsumedItems(removedItems) {
    const rollbackByIngredient = removedItems.reduce((map, item) => {
      const key = String(item.ingredient_id)
      map.set(key, (map.get(key) || 0) + getDiningItemConsumedQty(item))
      return map
    }, new Map())
    const rollbackIngredientIds = [...rollbackByIngredient.keys()]
    const freshIngredients = await fetchIngredientsByIds(rollbackIngredientIds)
    const clipWarnings = []

    for (const ingredient of freshIngredients) {
      const rollbackQty = rollbackByIngredient.get(String(ingredient.id)) || 0
      const currentConsumed = Number(ingredient.consumed_quantity) || 0
      const totalQty = Number(ingredient.quantity) || 0
      const desiredConsumed = parseFloat((currentConsumed - rollbackQty).toFixed(2))
      // 夹紧到 [0, totalQty] 范围
      const newConsumed = Math.min(totalQty, Math.max(0, desiredConsumed))

      // 如果被边界限制，记录提示
      if (newConsumed !== desiredConsumed) {
        if (desiredConsumed < 0) {
          clipWarnings.push(`・${ingredient.name_zh}：回退后库存消耗量不能为负，已设为 0（原计算值为 ${desiredConsumed}）`)
        } else if (desiredConsumed > totalQty) {
          clipWarnings.push(`・${ingredient.name_zh}：回退后库存消耗量不能超过总数 ${totalQty}${ingredient.unit}，已设为 ${totalQty}${ingredient.unit}（原计算值为 ${desiredConsumed}）`)
        }
      }

      const isFullyConsumed = totalQty > 0 && newConsumed >= totalQty

      await supabase.from('ingredients').update({ consumed_quantity: newConsumed }).eq('id', ingredient.id)
      if (ingredient.purchase_item_id) {
        await supabase.from('purchase_items').update({
          consumed_quantity: newConsumed,
          is_fully_consumed: isFullyConsumed
        }).eq('id', ingredient.purchase_item_id)
      }
    }

    if (clipWarnings.length > 0) {
      window.alert(`⚠️ 以下食材库存调整时已被自动限制到合理范围：\n\n${clipWarnings.join('\n')}`)
    }
  }

  const existingIngIds = new Set(items.map(i => i.ingredient_id).filter(Boolean).map(String))

  async function save() {
    setSaving(true)
    try {
      await supabase.from('dining_history').update({
        meal_time: header.meal_time || null,
        dined_at: header.dined_at,
        dined_time: header.dined_time || null,
        store_name: header.store_name || null,
        store_name_original: header.store_name_original || null,
        amount: header.amount ? Number(header.amount) : null,
        memo: header.memo || null
      }).eq('id', record.id)

      if (record.dining_type === 'out') {
        await supabase.from('dining_items').delete().eq('dining_id', record.id)
        const validItems = items.filter(i => i.name_zh?.trim())
        if (validItems.length > 0) {
          await supabase.from('dining_items').insert(
            validItems.map(item => ({
              dining_id: record.id,
              name_zh: item.name_zh,
              name_original: item.name_original || null,
              quantity: Number(item.quantity) || 1,
              unit: item.unit || '份',
              price: item.price ? Number(item.price) : null
            }))
          )
        }
      }

      if (record.dining_type === 'home') {
        const originalItems = record.dining_items || []
        const currentItemIds = new Set(items.map(i => i.id).filter(Boolean))
        const removedItems = originalItems.filter(item => item.id && !currentItemIds.has(item.id))
        const removedItemIds = removedItems.map(item => item.id)
        const rollbackCandidates = removedItems.filter(item => item.ingredient_id && item.update_consumed && getDiningItemConsumedQty(item) > 0)

        if (rollbackCandidates.length > 0) {
          const rollbackSummary = rollbackCandidates
            .map(item => `・${item.name_zh || '未命名食材'} ${formatDiningItemQty(item)}`)
            .join('\n')
          await new Promise(resolve => {
            setPendingConfirm({
              title: '回退库存',
              message: `已删除 ${rollbackCandidates.length} 个曾同步消耗量的食材。是否将这些消耗量回退到食用品库存？\n\n${rollbackSummary}`,
              confirmText: '是',
              cancelText: '否',
              confirmColor: '#16a34a',
              onConfirm: async () => {
                await rollbackRemovedConsumedItems(rollbackCandidates)
                setPendingConfirm(null)
                resolve()
              },
              onCancel: () => {
                setPendingConfirm(null)
                resolve()
              }
            })
          })
        }

        if (removedItemIds.length > 0) {
          await supabase.from('dining_items').delete().in('id', removedItemIds)
        }

        // ---- 检查消耗量变化，弹窗确认是否同步库存 ----
        const qtyChangedItems = items
          .filter(item => item.ingredient_id)
          .map(item => {
            const original = originalItems.find(o => o.id === item.id)
            if (!original) return null
            if (!original.update_consumed) return null
            const oldQty = getDiningItemConsumedQty(original)
            const newQty = Number(item.qty_edit) || getDiningItemConsumedQty(item)
            const delta = parseFloat((newQty - oldQty).toFixed(2))
            if (Math.abs(delta) < 0.001) return null
            return { item, original, oldQty, newQty, delta }
          })
          .filter(Boolean)

        if (qtyChangedItems.length > 0) {
          const qtyChangeSummary = qtyChangedItems
            .map(({ item, oldQty, newQty, delta }) => {
              const action = delta > 0 ? '增加' : '减少'
              return `・${item.name_zh}：${oldQty} → ${newQty}（${action} ${Math.abs(delta)}${item.unit}）`
            })
            .join('\n')
          if (await new Promise(resolve => {
            setPendingConfirm({
              title: '同步库存',
              message: `以下食材消耗量已调整，是否同步更新食用品库存？\n\n${qtyChangeSummary}`,
              confirmText: '是',
              cancelText: '否',
              confirmColor: '#16a34a',
              onConfirm: () => {
                setPendingConfirm(null)
                resolve(true)
              },
              onCancel: () => {
                setPendingConfirm(null)
                resolve(false)
              }
            })
          })) {
            // 从数据库实时获取最新数据，避免使用过期 state
            const ingredientIds = [...new Set(qtyChangedItems.map(({ item }) => item.ingredient_id).filter(Boolean))]
            const freshIngredients = await fetchIngredientsByIds(ingredientIds)
            const ingredientById = new Map(freshIngredients.map(i => [String(i.id), i]))
            const clipWarnings = []

            for (const { item, delta } of qtyChangedItems) {
              const ingredient = ingredientById.get(String(item.ingredient_id))
              if (ingredient) {
                const currentConsumed = Number(ingredient.consumed_quantity) || 0
                const totalQty = Number(ingredient.quantity) || 0
                const desiredConsumed = parseFloat((currentConsumed + delta).toFixed(2))
                // 夹紧到 [0, totalQty] 范围
                const newConsumed = Math.min(totalQty, Math.max(0, desiredConsumed))

                // 如果被边界限制，记录提示
                if (newConsumed !== desiredConsumed) {
                  if (desiredConsumed < 0) {
                    clipWarnings.push(`・${item.name_zh}：库存消耗量不能为负，已设为 0（原计算值为 ${desiredConsumed}）`)
                  } else if (desiredConsumed > totalQty) {
                    clipWarnings.push(`・${item.name_zh}：库存消耗量不能超过总数 ${totalQty}${ingredient.unit}，已设为 ${totalQty}${ingredient.unit}（原计算值为 ${desiredConsumed}）`)
                  }
                }

                const isFullyConsumed = totalQty > 0 && newConsumed >= totalQty
                await supabase.from('ingredients').update({ consumed_quantity: newConsumed }).eq('id', ingredient.id)
                if (ingredient.purchase_item_id) {
                  await supabase.from('purchase_items').update({
                    consumed_quantity: newConsumed,
                    is_fully_consumed: isFullyConsumed
                  }).eq('id', ingredient.purchase_item_id)
                }
              }
            }

            if (clipWarnings.length > 0) {
              window.alert(`⚠️ 以下食材库存调整时已被自动限制到合理范围：\n\n${clipWarnings.join('\n')}`)
            }
          }
        }
        // ---- 消耗量变化处理结束 ----

        for (const item of items) {
          if (item.id) {
            await supabase.from('dining_items').update({
              consumed_quantity: Number(item.qty_edit) || item.consumed_quantity,
              price_contribution: item.ingredient_id
                ? calcCost(findIngredientById(ingredients, item.ingredient_id), Number(item.qty_edit))
                : null
            }).eq('id', item.id)
          }
        }

        const newItems = Object.entries(addSelected).map(([id, s]) => {
          const ing = findIngredientById(ingredients, id)
          if (!ing) return null
          return {
            dining_id: record.id,
            name_zh: ing.name_zh,
            name_original: ing.name_original || null,
            category: ing.category || null,
            quantity: ing.quantity,
            unit: ing.unit || '个',
            consumed_quantity: s.qty,
            ingredient_id: ing.id,
            update_consumed: false,
            price_contribution: calcCost(ing, s.qty)
          }
        }).filter(Boolean)
        if (newItems.length > 0) await supabase.from('dining_items').insert(newItems)

        const existingCost = items.reduce((sum, item) => {
          if (!item.ingredient_id) return sum
          const ing = findIngredientById(ingredients, item.ingredient_id)
          return sum + calcCost(ing, Number(item.qty_edit))
        }, 0)
        const addedCost = Object.entries(addSelected).reduce((sum, [id, s]) => {
          const ing = findIngredientById(ingredients, id)
          return sum + (ing ? calcCost(ing, s.qty) : 0)
        }, 0)
        const newCost = existingCost + addedCost
        await supabase.from('dining_history').update({ home_cost: Math.round(newCost * 10) / 10 }).eq('id', record.id)
      }
    } catch (e) {
      console.error("Error saving record:", e)
      alert("保存失败: " + e.message)
    } finally {
      setSaving(false)
      onSaved()
      onClose()
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 999 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>编辑{record.dining_type === 'home' ? '自炊' : '外食'}记录</div>
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
              <input style={smallField} type="date" value={header.dined_at} onChange={e => setHeader(h => ({ ...h, dined_at: e.target.value }))} />
            </div>
            {record.dining_type === 'out' && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>时间</div>
                <input style={smallField} type="time" value={header.dined_time || ''} onChange={e => setHeader(h => ({ ...h, dined_time: e.target.value }))} />
              </div>
            )}
          </div>

          {record.dining_type === 'out' && (
            <>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>店名</div>
                <input style={smallField} value={header.store_name} onChange={e => setHeader(h => ({ ...h, store_name: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>金额（¥）</div>
                <input style={smallField} type="number" value={header.amount || ''} onChange={e => setHeader(h => ({ ...h, amount: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>菜品明细</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {items.map((item, i) => (
                    <div key={i} style={{ background: '#f8fafc', borderRadius: 9, padding: '8px 10px' }}>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                        <input style={{ ...smallField, flex: 1 }} value={item.name_zh || ''} onChange={e => setItems(currentItems => { const n=[...currentItems]; n[i]={...n[i],name_zh:e.target.value}; return n })} />
                        <button onClick={() => setItems(currentItems => currentItems.filter((_, j) => j !== i))}
                          style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1 }}>×</button>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>份数</div>
                          <input style={smallField} type="number" value={item.quantity || 1} onChange={e => setItems(currentItems => { const n=[...currentItems]; n[i]={...n[i],quantity:e.target.value}; return n })} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>单价¥</div>
                          <input style={smallField} type="number" value={item.price || ''} onChange={e => setItems(currentItems => { const n=[...currentItems]; n[i]={...n[i],price:e.target.value}; return n })} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={() => setItems(i =>[...i, { name_zh: '', quantity: 1, unit: '份', price: '' }])}
                  style={{ marginTop: 7, width: '100%', padding: '7px 0', borderRadius: 8, background: '#f1f5f9', color: '#475569', fontSize: 13, fontWeight: 600 }}>
                  + 添加菜品
                </button>
              </div>
            </>
          )}

          {record.dining_type === 'home' && (
            <div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>已选食材</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>步长</span>
                {QUICK_STEPS.map(step => {
                  const activeItem = activeEditItemIndex !== null ? items[activeEditItemIndex] : null
                  const maxQty = activeItem ? Number(activeItem.quantity) || Number(activeItem.qty_edit) || 0 : 0
                  const disabled = !activeItem || maxQty < step
                  return (
                    <button key={step} onClick={() => {
                      setActiveQtyStep(step)
                      if (activeEditItemIndex === null) return
                      setItems(currentItems => currentItems.map((item, index) => {
                        if (index !== activeEditItemIndex) return item
                        const itemMaxQty = Number(item.quantity) || Number(item.qty_edit) || 0
                        return { ...item, qty_edit: Math.min(itemMaxQty, step) }
                      }))
                    }} disabled={disabled}
                      style={{
                        padding: '3px 8px',
                        borderRadius: 999,
                        fontSize: 12,
                        border: `1px solid ${activeQtyStep === step ? '#16a34a' : '#cbd5e1'}`,
                        background: disabled ? '#f1f5f9' : (activeQtyStep === step ? '#dcfce7' : '#fff'),
                        color: disabled ? '#94a3b8' : (activeQtyStep === step ? '#166534' : '#475569'),
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled ? 0.7 : 1
                      }}>
                      {step}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {items.map((item, i) => {
                  const isActiveStepItem = activeEditItemIndex === i
                  return (
                    <div key={i} onClick={() => setActiveEditItemIndex(i)} style={{
                      background: '#f0fdf4',
                      border: `1.5px solid ${isActiveStepItem ? '#16a34a' : 'transparent'}`,
                      borderRadius: 9,
                      padding: '8px 11px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer'
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{item.name_zh}</div>
                        <div style={{ fontSize: 11, color: isActiveStepItem ? '#16a34a' : '#94a3b8' }}>
                          {isActiveStepItem ? '当前步长应用对象' : '点击此食材设为步长应用对象'}
                        </div>
                      {item.price_contribution > 0 && (
                        <div style={{ fontSize: 11, color: '#16a34a' }}>成本 ¥{item.price_contribution}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <button onClick={() => setItems(currentItems => { const n=[...currentItems]; n[i]={...n[i],qty_edit:Math.max(activeQtyStep,parseFloat(((n[i].qty_edit||1)-activeQtyStep).toFixed(2)))}; return n })}
                        style={{ width: 22, height: 22, borderRadius: 5, background: '#f1f5f9', color: '#475569', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 36, textAlign: 'center' }}>{item.qty_edit}{item.unit}</span>
                      <button onClick={() => setItems(currentItems => { const n=[...currentItems]; const maxQty = Number(n[i].quantity) || Number(n[i].qty_edit) || 0; n[i]={...n[i],qty_edit:Math.min(maxQty, parseFloat(((n[i].qty_edit||1)+activeQtyStep).toFixed(2)))}; return n })}
                        style={{ width: 22, height: 22, borderRadius: 5, background: '#f1f5f9', color: '#475569', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                    </div>
                      <button onClick={e => {
                        e.stopPropagation()
                        setItems(currentItems => currentItems.filter((_, j) => j !== i))
                      }} style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1 }}>×</button>
                    </div>
                  )
                })}
              </div>

              <button onClick={() => setShowAddMore(!showAddMore)} style={{
                marginTop: 8, width: '100%', padding: '7px 0', borderRadius: 8,
                background: '#f0fdf4', color: '#16a34a', fontSize: 13, fontWeight: 600,
                border: '1px dashed #86efac'
              }}>
                {showAddMore ? '收起' : '+ 追加食材'}
              </button>

              {showAddMore && (
                <div style={{ marginTop: 8 }}>
                  <IngredientPicker
                    dinedAt={record.dined_at}
                    selected={addSelected}
                    setSelected={setAddSelected}
                    ingredients={ingredients.filter(i => !existingIngIds.has(String(i.id)))}
                    loading={false}
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>备注</div>
            <input style={smallField} value={header.memo} onChange={e => setHeader(h => ({ ...h, memo: e.target.value }))} />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '11px 0', borderRadius: 10, background: '#f1f5f9', color: '#475569', fontSize: 14, fontWeight: 600 }}>取消</button>
            <button onClick={save} disabled={saving} style={{ flex: 2, padding: '11px 0', borderRadius: 10, background: '#f97316', color: '#fff', fontSize: 14, fontWeight: 700 }}>{saving ? '保存中...' : '保存'}</button>
          </div>
        </div>
      </div>
      {pendingConfirm && (
        <ConfirmModal
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          confirmText={pendingConfirm.confirmText}
          cancelText={pendingConfirm.cancelText}
          confirmColor={pendingConfirm.confirmColor}
          onConfirm={pendingConfirm.onConfirm}
          onCancel={pendingConfirm.onCancel}
        />
      )}
    </div>
  )
}

function IngredientSelectModal({ diningId, dinedAt, existingItems, onClose, onSaved }) {
  const { settings } = useSettings()
  const [ingredients, setIngredients] = useState([])
  const[selected, setSelected] = useState({})
  const [activeIngredientId, setActiveIngredientId] = useState(null)
  const [showConsumed, setShowConsumed] = useState(false)
  const [saving, setSaving] = useState(false)
  const diningQtyStep = Math.min(10, Math.max(0.01, Number(settings.dining_qty_step) || 1))
  const QUICK_STEPS = [0.01, 0.1, 1, 5, 10]
  const [activeQtyStep, setActiveQtyStep] = useState(diningQtyStep)

  useEffect(() => {
    fetchIngredients()
    if (existingItems?.length) {
      const pre = {}
      existingItems.forEach(item => {
        if (item.ingredient_id) {
          pre[item.ingredient_id] = { qty: item.consumed_quantity || item.quantity || 1, updateConsumed: item.update_consumed || false, existingItemId: item.id }
        }
      })
      setSelected(pre)
    }
  },[dinedAt, existingItems])

  async function fetchIngredients() {
    const { data } = await supabase
      .from('ingredients')
      .select(`
        *,
        purchase_item:purchase_item_id(
          price,
          original_price,
          purchase_history:history_id(purchased_at)
        )
      `)
      .order('created_at', { ascending: false })
    setIngredients(await hydrateLatestPurchasePrices(data || []))
  }

  const filtered = ingredients.filter(i =>
    showConsumed ? true : getIngredientRemaining(i) > 0
  )

  function toggleSelect(ing) {
    setSelected(s => {
      if (s[ing.id]) {
        const next = { ...s }
        delete next[ing.id]
        if (String(activeIngredientId) === String(ing.id)) setActiveIngredientId(null)
        return next
      }
      setActiveIngredientId(ing.id)
      return { ...s, [ing.id]: { qty: clampIngredientQty(ing, activeQtyStep, 0.01), updateConsumed: false, existingItemId: null } }
    })
  }

  const totalCost = Object.entries(selected).reduce((sum,[id, s]) => {
    const ing = findIngredientById(ingredients, id)
    return sum + (ing ? calcIngredientCost(ing, s.qty) : 0)
  }, 0)

  async function save() {
    setSaving(true)
    try {
      const entries = Object.entries(selected)
      for (const [ingId, s] of entries) {
        const ing = findIngredientById(ingredients, ingId)
        if (!ing) continue
        const cost = calcIngredientCost(ing, s.qty)

        if (s.existingItemId) {
          await supabase.from('dining_items').update({
            consumed_quantity: s.qty,
            update_consumed: s.updateConsumed,
            price_contribution: cost
          }).eq('id', s.existingItemId)
        } else {
          await supabase.from('dining_items').insert({
            dining_id: diningId,
            name_zh: ing.name_zh,
            name_original: ing.name_original || null,
            category: ing.category || null,
            quantity: ing.quantity,
            unit: ing.unit || '个',
            consumed_quantity: s.qty,
            ingredient_id: ing.id,
            update_consumed: s.updateConsumed,
            price_contribution: cost
          })
        }

        if (s.updateConsumed) {
          const newConsumed = Math.min(
            (ing.consumed_quantity || 0) + s.qty,
            ing.quantity || 0
          )
          const isFullyConsumed = newConsumed >= (ing.quantity || 0)
          await supabase.from('ingredients').update({ consumed_quantity: newConsumed }).eq('id', ing.id)
          if (ing.purchase_item_id && isFullyConsumed) {
            await supabase.from('purchase_items').update({ is_fully_consumed: true, consumed_quantity: newConsumed }).eq('id', ing.purchase_item_id)
          }
        }
      }
      await supabase.from('dining_history').update({ home_cost: Math.round(totalCost * 10) / 10 }).eq('id', diningId)
    } catch (e) {
      alert("保存失败: " + e.message)
    } finally {
      setSaving(false)
      onSaved()
      onClose()
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>选择食材</div>
          <button onClick={onClose} style={{ background: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>
          仅显示 {dinedAt} 当天及之前入库的食用品
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#475569', marginBottom: 12 }}>
          <input type="checkbox" checked={showConsumed} onChange={e => setShowConsumed(e.target.checked)}
            style={{ width: 15, height: 15, accentColor: '#16a34a' }} />
          显示已食用完的食品
        </label>

        {Object.keys(selected).length > 0 && (
          <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>
            已选 {Object.keys(selected).length} 种食材
            {totalCost > 0 && <span style={{ marginLeft: 8, fontWeight: 600, color: '#16a34a' }}>预计成本 ¥{totalCost.toFixed(1)}</span>}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>步长</span>
          {QUICK_STEPS.map(step => (
            <button key={step} onClick={() => {
              setActiveQtyStep(step)
              if (!activeIngredientId) return
              setSelected(s => {
                if (!s[activeIngredientId]) return s
                const ing = findIngredientById(filtered, activeIngredientId)
                return {
                  ...s,
                  [activeIngredientId]: { ...s[activeIngredientId], qty: ing ? clampIngredientQty(ing, step, 0.01) : step }
                }
              })
            }} disabled={filtered.every(ing => getIngredientSelectableLimit(ing) < step)}
              style={{
                padding: '4px 8px',
                borderRadius: 999,
                fontSize: 12,
                border: `1px solid ${activeQtyStep === step ? '#16a34a' : '#cbd5e1'}`,
                background: filtered.every(ing => getIngredientSelectableLimit(ing) < step) ? '#f1f5f9' : (activeQtyStep === step ? '#dcfce7' : '#fff'),
                color: filtered.every(ing => getIngredientSelectableLimit(ing) < step) ? '#94a3b8' : (activeQtyStep === step ? '#166534' : '#475569'),
                cursor: filtered.every(ing => getIngredientSelectableLimit(ing) < step) ? 'not-allowed' : 'pointer',
                opacity: filtered.every(ing => getIngredientSelectableLimit(ing) < step) ? 0.7 : 1
              }}>
              {step}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {filtered.map(ing => {
            const remaining = getIngredientRemaining(ing)
            const selectableLimit = getIngredientSelectableLimit(ing)
            const isSelected = !!selected[ing.id]
            const sel = selected[ing.id]
            const cost = isSelected ? calcIngredientCost(ing, sel?.qty ?? 1) : 0

            return (
              <div key={ing.id} style={{
                background: isSelected ? '#f0fdf4' : '#f8fafc',
                border: `1.5px solid ${isSelected ? '#16a34a' : '#e2e8f0'}`,
                borderRadius: 12, padding: '10px 12px'
              }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div onClick={() => toggleSelect(ing)} style={{
                    width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 2, cursor: 'pointer',
                    border: `2px solid ${isSelected ? '#16a34a' : '#cbd5e1'}`,
                    background: isSelected ? '#16a34a' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    {isSelected && <span style={{ color: '#fff', fontSize: 13 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{ing.name_zh}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>
                      剩余 {remaining.toFixed(2)}{ing.unit}
                      {ing.purchase_item?.price && ` · ¥${ing.purchase_item.price}/${ing.quantity}${ing.unit}`}
                    </div>
                    {isSelected && (
                      <div onClick={() => setActiveIngredientId(ing.id)} style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: 11, color: String(activeIngredientId) === String(ing.id) ? '#16a34a' : '#94a3b8' }}>
                          {String(activeIngredientId) === String(ing.id) ? '当前步长应用对象' : '点击此区域设为步长应用对象'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontSize: 12, color: '#475569', width: 60 }}>使用量</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button onClick={() => setSelected(s => ({ ...s, [ing.id]: { ...s[ing.id], qty: clampIngredientQty(ing, parseFloat(((s[ing.id]?.qty || 1) - activeQtyStep).toFixed(2)), 0.01) } }))}
                              style={{ width: 26, height: 26, borderRadius: 6, background: '#f1f5f9', color: '#475569', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                            <input type="number" value={sel?.qty ?? 1} step={activeQtyStep} max={selectableLimit}
                              onChange={e => setSelected(s => ({ ...s, [ing.id]: { ...s[ing.id], qty: clampIngredientQty(ing, e.target.value, 0) } }))}
                              style={{ width: 60, textAlign: 'center', ...smallField }} />
                            <span style={{ fontSize: 13, color: '#475569' }}>{ing.unit}</span>
                            <button onClick={() => setSelected(s => ({ ...s,[ing.id]: { ...s[ing.id], qty: clampIngredientQty(ing, parseFloat(((s[ing.id]?.qty || 1) + activeQtyStep).toFixed(2)), 0.01) } }))}
                              style={{ width: 26, height: 26, borderRadius: 6, background: '#f1f5f9', color: '#475569', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                          </div>
                          {cost > 0 && <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>¥{cost.toFixed(1)}</span>}
                        </div>
                        {remaining > 0 && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#475569' }}>
                            <input type="checkbox" checked={sel?.updateConsumed || false}
                              onChange={e => setSelected(s => ({ ...s, [ing.id]: { ...s[ing.id], updateConsumed: e.target.checked } }))}
                              style={{ width: 14, height: 14, accentColor: '#16a34a' }} />
                            同步更新食用量
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <button onClick={save} disabled={saving || Object.keys(selected).length === 0} style={{
          width: '100%', padding: '13px 0', borderRadius: 12,
          background: Object.keys(selected).length > 0 ? '#16a34a' : '#e2e8f0',
          color: Object.keys(selected).length > 0 ? '#fff' : '#94a3b8',
          fontSize: 15, fontWeight: 700
        }}>{saving ? '保存中...' : `保存（${Object.keys(selected).length} 种食材${totalCost > 0 ? '，成本 ¥' + totalCost.toFixed(1) : ''}）`}</button>
      </div>
    </div>
  )
}

function AddDiningModal({ onClose, onSaved }) {
  const [outCurrency, setOutCurrency] = useState('JPY')
  const { settings } = useSettings()
  const[diningType, setDiningType] = useState(null)
  const [mealTime, setMealTime] = useState(null)
  const [dinedAt, setDinedAt] = useState(new Date().toISOString().split('T')[0])
  const [dinedTime, setDinedTime] = useState('')
  const[memo, setMemo] = useState('')
  const [manualDishes, setManualDishes] = useState([])
  const[pendingPhotos, setPendingPhotos] = useState([]) // { file: File, url: string }[]
  
  const[homeSelected, setHomeSelected] = useState({})
  const [ingredients, setIngredients] = useState([])
  const[loadingIng, setLoadingIng] = useState(false)

  const [outMode, setOutMode] = useState(null)
  const [storeName, setStoreName] = useState('')
  const[storeNameOriginal, setStoreNameOriginal] = useState('')
  const [amount, setAmount] = useState('')
  const[outItems, setOutItems] = useState([])
  const [billData, setBillData] = useState(null)
  
  // States to prevent button clashing and show progress
  const [loading, setLoading] = useState(false) 
  const [saving, setSaving] = useState(false)
  const [saveText, setSaveText] = useState('保存记录')

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

  async function callAI(messages) {
  const models = settings.ai_models || []
  const selectedName = settings.ai_selected_model || ''
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
      max_tokens: Number(settings.ai_max_tokens) || 4096,
      messages
    })
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
    } catch {}
    return null
  }

  useEffect(() => {
    if (diningType === 'home') fetchIngredients()
  }, [diningType, dinedAt])

  async function fetchIngredients() {
    setLoadingIng(true)
    const { data } = await supabase
      .from('ingredients')
      .select(`
        *,
        purchase_item:purchase_item_id(
          price,
          purchase_history:history_id(store_name, purchased_at)
        )
      `)
      .order('created_at', { ascending: false })
    setIngredients(await hydrateLatestPurchasePrices(data || []))
    setLoadingIng(false)
  }

  function calcCost(ing, qty) {
    const price = ing.purchase_item?.price
    if (!price || !qty) return 0
    return Math.round((price * qty / (ing.quantity || 1)) * 10) / 10
  }

  const totalHomeCost = Object.entries(homeSelected).reduce((sum, [id, s]) => {
    const ing = findIngredientById(ingredients, id)
    return sum + (ing ? calcCost(ing, s.qty) : 0)
  }, 0)

  async function recognizeBill(files) {
    setLoading(true)
    try {
      const parts =[]
      for (const file of files) {
        const base64 = await fileToBase64(file)
        parts.push({ type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: base64 } })
      }
      parts.push({ type: 'text', text: `识别这张餐饮账单（支持中日英文），输出JSON：{"store_name":"店名中文","store_name_original":"店名原文","dined_at":"YYYY-MM-DD或空","dined_time":"HH:MM或空","amount":合计或null,"items":[{"name_zh":"菜品中文名","name_original":"原文","quantity":数量,"unit":"份","price":单价或null}]}只输出JSON。` })
      const text = await callAI([{ role: 'user', content: parts }])
      const result = parseJSON(text)
      if (result) {
        setBillData(result)
        setStoreName(result.store_name || '')
        setStoreNameOriginal(result.store_name_original || '')
        if (result.dined_at) setDinedAt(result.dined_at)
        if (result.dined_time) setDinedTime(result.dined_time)
        if (result.amount) setAmount(String(result.amount))
        setOutItems((result.items ||[]).map(i => ({ ...i, price: i.price || '' })))
      }
    } catch (e) { alert('识别失败：' + e.message) }
    setLoading(false)
  }

  async function recognizeOutDish(files) {
    setLoading(true)
    try {
      const parts =[]
      for (const file of files) {
        const base64 = await fileToBase64(file)
        parts.push({ type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: base64 } })
      }
      parts.push({ type: 'text', text: `识别图片中的餐厅菜品（支持中日英文），输出JSON数组：[{"name_zh":"中文名","name_original":"原文","quantity":1,"unit":"份"}]只输出JSON数组。` })
      const text = await callAI([{ role: 'user', content: parts }])
      const result = parseJSON(text)
      if (Array.isArray(result)) {
        setOutItems(prev =>[...prev, ...result.map(i => ({ ...i, price: '' }))])
      }
    } catch (e) { alert('识别失败：' + e.message) }
    setLoading(false)
  }

  const setOutItemField = useCallback((i, k, v) => {
    setOutItems(items => { const n = [...items]; n[i] = { ...n[i], [k]: v }; return n })
  },[])

  const canSave = diningType && (
    diningType === 'home' ? mealTime : (storeName.trim() && dinedAt && amount)
  )

  // --- BUG FIX: Use sequential uploading to avoid network hanging on massive files ---
  async function save() {
    if (diningType === 'out' && (!storeName.trim() || !dinedAt || !amount)) {
      return alert('外食记录需要填写店名、就餐日期和金额')
    }
    setSaving(true)
    setSaveText('保存数据中...')

    try {
      const originalAmount = amount ? Number(amount) : null
      const jpyAmount = outCurrency === 'JPY' ? originalAmount : toJPY(originalAmount, outCurrency, settings)

      const { data: dining } = await supabase.from('dining_history').insert({
        dining_type: diningType,
        meal_time: mealTime || null,
        dined_at: dinedAt,
        dined_time: diningType === 'out' ? (dinedTime || null) : null,
        store_name: diningType === 'out' ? storeName : null,
        store_name_original: diningType === 'out' ? storeNameOriginal : null,
        amount: jpyAmount,
        original_amount: diningType === 'out' && outCurrency !== 'JPY' ? originalAmount : null,
        currency: diningType === 'out' ? outCurrency : 'JPY',
        home_cost: diningType === 'home' && totalHomeCost > 0 ? Math.round(totalHomeCost * 10) / 10 : null,
        memo: memo || null
      }).select().single()

      if (dining) {
        const dishesToInsert =[]

        if (diningType === 'out' && outItems.length > 0) {
          outItems.filter(i => i.name_zh?.trim()).forEach(item => {
            dishesToInsert.push({
              dining_id: dining.id,
              name_zh: item.name_zh,
              name_original: item.name_original || null,
              quantity: Number(item.quantity) || 1,
              unit: item.unit || '份',
              price: item.price ? Number(item.price) : null
            })
          })
        }

        if (diningType === 'home' && Object.keys(homeSelected).length > 0) {
          Object.entries(homeSelected).forEach(([id, s]) => {
            const ing = findIngredientById(ingredients, id)
            if (!ing) return
            dishesToInsert.push({
              dining_id: dining.id,
              name_zh: ing.name_zh,
              name_original: ing.name_original || null,
              category: ing.category || null,
              quantity: ing.quantity,
              unit: ing.unit || '个',
              consumed_quantity: s.qty,
              ingredient_id: ing.id,
              update_consumed: s.updateConsumed || false,
              price_contribution: calcCost(ing, s.qty)
            })
          })
        }

        manualDishes.filter(d => d.name_zh.trim()).forEach(d => {
          dishesToInsert.push({
            dining_id: dining.id,
            name_zh: d.name_zh,
            quantity: Number(d.quantity) || 1,
            unit: d.unit || '人份',
            price: d.price ? Number(d.price) : null
          })
        })

        if (dishesToInsert.length > 0) {
          await supabase.from('dining_items').insert(dishesToInsert)
        }

        if (diningType === 'home') {
          for (const[id, s] of Object.entries(homeSelected)) {
            if (!s.updateConsumed) continue
            const ing = findIngredientById(ingredients, id)
            if (!ing) continue
            const newConsumed = parseFloat(Math.min((ing.consumed_quantity || 0) + s.qty, ing.quantity || 0).toFixed(2))
            const isFully = newConsumed >= (ing.quantity || 0)
            await supabase.from('ingredients').update({ consumed_quantity: newConsumed }).eq('id', id)
            if (ing.purchase_item_id && isFully) {
              await supabase.from('purchase_items').update({ is_fully_consumed: true, consumed_quantity: newConsumed }).eq('id', ing.purchase_item_id)
            }
          }
        }
        
        // 依次上传照片（防止 Promise.all 死锁网络请求）
        const photosToUpload = pendingPhotos.filter(p => p && p.file)
        if (photosToUpload.length > 0) {
          let count = 1;
          for (const { file } of photosToUpload) {
            setSaveText(`上传照片中 (${count}/${photosToUpload.length})...`)
            try {
              const { filePath, url } = await uploadPhoto(supabase, file, `dining/${dining.id}`)
              await supabase.from('dining_photos').insert({
                dining_id: dining.id,
                dining_item_id: null,
                file_path: filePath,
                url
              })
            } catch (e) {
              console.error('照片上传失败', e)
            }
            count++;
          }
        }
      }
      
      onSaved()
      onClose() // 一切完成后才关闭，防止组件提前卸载阻断流程

    } catch (e) {
      alert("保存失败: " + e.message)
    } finally {
      setSaving(false)
      setSaveText('保存记录')
    }
  }
  // --- BUG FIX ENDS HERE ---

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 430, maxHeight: '95vh', overflowY: 'auto' }}>
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
              <button key={id} onClick={() => { setDiningType(id); setOutMode(null) }} style={{
                padding: '12px 0', borderRadius: 10, fontSize: 14, fontWeight: 600,
                background: diningType === id ? (id === 'home' ? '#16a34a' : '#f97316') : '#f1f5f9',
                color: diningType === id ? '#fff' : '#94a3b8'
              }}>{label}</button>
            ))}
          </div>
        </div>

        {diningType === 'home' && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 8 }}>
              选择食材
              {Object.keys(homeSelected).length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 12, color: '#16a34a' }}>
                  已选 {Object.keys(homeSelected).length} 种
                  {totalHomeCost > 0 && `，成本 ¥${totalHomeCost.toFixed(1)}`}
                </span>
              )}
            </div>
            <IngredientPicker
              dinedAt={dinedAt}
              selected={homeSelected}
              setSelected={setHomeSelected}
              ingredients={ingredients}
              loading={loadingIng}
            />
          </div>
        )}

        {diningType === 'out' && (
          <>
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

            {outMode === 'bill' && (
              <div style={{ marginBottom: 14 }}>
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: '#f97316' }}><div style={{ fontSize: 24 }}>✨</div>识别中...</div>
                ) : !billData ? (
                  <div>
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }} id="bill-input"
                      onChange={e => {
                        const files = Array.from(e.target.files)
                        const newItems = files.map(f => ({ file: f, url: URL.createObjectURL(f) }))
                        setPendingPhotos(p => [...p, ...newItems]) 
                        e.target.value = ''
                        recognizeBill(files)
                      }}/>
                    <button onClick={() => document.getElementById('bill-input').click()} style={{
                      width: '100%', padding: '24px 0', borderRadius: 12, border: '2px dashed #fed7aa',
                      background: '#fff7ed', color: '#9a3412', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6
                    }}>
                      <span style={{ fontSize: 32 }}>🧾</span>
                      <span style={{ fontWeight: 600 }}>拍摄或选择账单照片</span>
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ background: '#fff7ed', borderRadius: 10, padding: '8px 12px', fontSize: 13, color: '#9a3412' }}>已识别账单</div>
                    {outItems.map((item, i) => (
                      <div key={i} style={{ background: '#f8fafc', borderRadius: 9, padding: '8px 10px' }}>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                          <input style={{ ...smallField, flex: 1 }} value={item.name_zh} onChange={e => setOutItemField(i, 'name_zh', e.target.value)} />
                          <button onClick={() => setOutItems(items => items.filter((_, j) => j !== i))}
                            style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1 }}>×</button>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>份数</div>
                            <input style={smallField} type="number" value={item.quantity || 1} onChange={e => setOutItemField(i, 'quantity', e.target.value)} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>单价¥</div>
                            <input style={smallField} type="number" value={item.price || ''} onChange={e => setOutItemField(i, 'price', e.target.value)} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>小计</div>
                            <div style={{ padding: '6px 7px', borderRadius: 7, background: '#fff', border: '1.5px solid #e2e8f0', fontSize: 13, fontWeight: 600, color: '#f97316' }}>
                              {item.price && item.quantity ? `¥${(Number(item.price)*Number(item.quantity)).toFixed(0)}` : '-'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => { setBillData(null); setOutItems([]) }}
                      style={{ padding: '6px 0', borderRadius: 7, background: '#f1f5f9', color: '#475569', fontSize: 13 }}>重新识别</button>
                  </div>
                )}
              </div>
            )}

            {outMode === 'dish' && (
              <div style={{ marginBottom: 14 }}>
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: '#f97316' }}><div style={{ fontSize: 24 }}>✨</div>识别中...</div>
                ) : (
                  <div>
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }} id="out-dish-input"
                      onChange={e => {
                        const files = Array.from(e.target.files)
                        const newItems = files.map(f => ({ file: f, url: URL.createObjectURL(f) }))
                        setPendingPhotos(p => [...p, ...newItems]) 
                        e.target.value = ''
                        recognizeOutDish(files)
                      }} />
                    <button onClick={() => document.getElementById('out-dish-input').click()} style={{
                      width: '100%', padding: '20px 0', borderRadius: 12, border: '2px dashed #fed7aa',
                      background: '#fff7ed', color: '#9a3412', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      marginBottom: outItems.length ? 8 : 0
                    }}>
                      <span style={{ fontSize: 28 }}>📷</span>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{outItems.length ? '继续添加照片' : '拍摄或选择菜品照片'}</span>
                    </button>
                    {outItems.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {outItems.map((item, i) => (
                          <div key={i} style={{ display: 'flex', gap: 6 }}>
                            <input style={{ ...smallField, flex: 1 }} value={item.name_zh} onChange={e => setOutItemField(i, 'name_zh', e.target.value)} />
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>店名、日期、金额为必填项</div>
              <input style={field} value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="店名（中文）*" />
              <input style={field} value={storeNameOriginal} onChange={e => setStoreNameOriginal(e.target.value)} placeholder="店名原文（可选）" />
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...field, flex: 1 }} type="date" value={dinedAt} onChange={e => setDinedAt(e.target.value)} />
                <input style={{ ...field, flex: 1 }} type="time" value={dinedTime} onChange={e => setDinedTime(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={outCurrency} onChange={e => setOutCurrency(e.target.value)}
                  style={{ padding: '10px 8px', borderRadius: 10, fontSize: 14, border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff' }}>
                  {(settings.exchange_rates || []).map(r => (
                    <option key={r.to} value={r.to}>{r.symbol} {r.to}</option>
                  ))}
                </select>
                <input style={{ ...field, flex: 1 }} type="number" value={amount}
                  onChange={e => setAmount(e.target.value)} placeholder="金额*" />
              </div>
            </div>
          </>
        )}
        
          {diningType && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                手动追加菜品（可选）
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {manualDishes.map((dish, i) => (
                  <div key={i} style={{ background: '#f8fafc', borderRadius: 9, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <input style={{ ...smallField, flex: 1 }} value={dish.name_zh}
                        placeholder="菜品名称"
                        onChange={e => setManualDishes(d => { const n=[...d]; n[i]={...n[i],name_zh:e.target.value}; return n })} />
                      <button onClick={() => setManualDishes(d => d.filter((_, j) => j !== i))}
                        style={{ background: 'none', color: '#cbd5e1', fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>份数</div>
                        <input style={smallField} type="number" value={dish.quantity}
                          onChange={e => setManualDishes(d => { const n=[...d]; n[i]={...n[i],quantity:e.target.value}; return n })} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>单位</div>
                        <select style={smallField} value={dish.unit}
                          onChange={e => setManualDishes(d => { const n=[...d]; n[i]={...n[i],unit:e.target.value}; return n })}>
                          {['人份','个','碗','盘','杯'].map(u => <option key={u}>{u}</option>)}
                        </select>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>单价（¥）</div>
                        <input style={smallField} type="number" value={dish.price || ''}
                          placeholder="可选"
                          onChange={e => setManualDishes(d => { const n=[...d]; n[i]={...n[i],price:e.target.value}; return n })} />
                      </div>
                    </div>
                  </div>
                ))}
                <button onClick={() => setManualDishes(d =>[...d, { name_zh: '', quantity: 1, unit: '人份', price: '' }])}
                  style={{ padding: '7px 0', borderRadius: 8, background: '#f1f5f9', color: '#475569', fontSize: 13, fontWeight: 600 }}>
                  + 添加菜品
                </button>
              </div>
            </div>
          )}
          
            {diningType && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 8 }}>
                  上传照片（可选）
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {pendingPhotos.map((item, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img
                        src={item.url}
                        alt=""
                        style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1.5px solid #e2e8f0', display: 'block' }}
                      />
                      <button
                        onClick={() => setPendingPhotos(p => p.filter((_, j) => j !== i))}
                        style={{
                          position: 'absolute', top: -6, right: -6,
                          width: 20, height: 20, borderRadius: '50%',
                          background: '#ef4444', color: '#fff', fontSize: 14, lineHeight: 1,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: '2px solid #fff'
                        }}>×</button>
                    </div>
                  ))}
                  <label style={{
                    width: 72, height: 72, borderRadius: 8,
                    border: '1.5px dashed #cbd5e1', background: '#f8fafc',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', cursor: 'pointer', gap: 3, flexShrink: 0
                  }}>
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                      onChange={e => {
                        const newItems = Array.from(e.target.files).map(f => ({
                          file: f,
                          url: URL.createObjectURL(f)
                        }))
                        setPendingPhotos(p =>[...p, ...newItems])
                        e.target.value = ''
                      }} />
                    <span style={{ fontSize: 24, color: '#94a3b8' }}>+</span>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>照片</span>
                  </label>
                </div>
              </div>
            )}

        <div style={{ marginBottom: 14 }}>
          <input style={field} value={memo} onChange={e => setMemo(e.target.value)} placeholder="备注（可选）" />
        </div>

        <button onClick={save} disabled={!canSave || saving || loading} style={{
          width: '100%', padding: '13px 0', borderRadius: 12,
          background: (canSave && !loading) ? (diningType === 'home' ? '#16a34a' : '#f97316') : '#e2e8f0',
          color: (canSave && !loading) ? '#fff' : '#94a3b8', fontSize: 15, fontWeight: 700
        }}>{saving ? saveText : (loading ? '识别中...' : '保存记录')}</button>
      </div>
    </div>
  )
}

export default function DiningHistory() {
  const { settings, saveSetting } = useSettings()
  const[records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [expanded, setExpanded] = useState({})
  const[collapsedYears, setCollapsedYears] = useState({})
  const[collapsedMonths, setCollapsedMonths] = useState({})
  const [editingRecord, setEditingRecord] = useState(null)
  const [detailItem, setDetailItem] = useState(null)
  const [selectingIngredients, setSelectingIngredients] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleteMode, setDeleteMode] = useState(null) // 'ask' | null
  const [deletingRecord, setDeletingRecord] = useState(false)
  const [photos, setPhotos] = useState({})
  const[uploadingKey, setUploadingKey] = useState(null)
  const [filterType, setFilterType] = useState('all')

  useEffect(() => { fetchRecords() },[])

  // 只查渲染真正用到的字段，避免全量拉取大文本列
  const DINING_HISTORY_SELECT = 'id, dining_type, meal_time, dined_at, dined_time, store_name, store_name_original, amount, home_cost, memo, created_at'
  const DINING_ITEM_SELECT = 'id, dining_id, name_zh, name_original, category, quantity, unit, price, consumed_quantity, ingredient_id, update_consumed, price_contribution, memo'

  // 拆 3 层嵌套为 2 次扁平批量查询（走 IN 索引 + 分批规避 URL 长度限制），再按 record 结构组装回
  async function hydrateDiningItems(records) {
    if (!records?.length) return records || []
    const diningIds = records.map(r => r.id)

    const items = await batchFetchIn('dining_items', 'dining_id', diningIds, DINING_ITEM_SELECT)

    const itemsByDiningId = new Map()
    ;(items || []).forEach(item => {
      const list = itemsByDiningId.get(item.dining_id) || []
      list.push(item)
      itemsByDiningId.set(item.dining_id, list)
    })

    const ingredientIds = [...new Set((items || []).map(i => i.ingredient_id).filter(Boolean))]
    const ingredientById = new Map()
    if (ingredientIds.length) {
      const ings = await batchFetchIn('ingredients', 'id', ingredientIds, 'id, quantity, purchase_item:purchase_item_id(price)')
      ;(ings || []).forEach(ing => ingredientById.set(String(ing.id), ing))
    }

    return records.map(r => {
      const dItems = itemsByDiningId.get(r.id) || []
      return {
        ...r,
        dining_items: dItems.map(item => ({
          ...item,
          ingredient: item.ingredient_id ? (ingredientById.get(String(item.ingredient_id)) || null) : null
        }))
      }
    })
  }

  async function fetchRecords() {
    setLoading(true)
    const { data, error } = await supabase
      .from('dining_history')
      .select(DINING_HISTORY_SELECT)
      .order('dined_at', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      console.warn('Failed to fetch dining records:', error)
      setRecords([])
      setLoading(false)
      return
    }

    const enriched = await hydrateDiningItems(data || [])
    setRecords(enriched)
    if (enriched?.length) await fetchPhotos(enriched.map(r => r.id))
    setLoading(false)
  }

  async function fetchPhotos(diningIds) {
    if (!diningIds.length) return
    const data = await batchFetchIn('dining_photos', 'dining_id', diningIds, 'id, dining_id, dining_item_id, file_path, url')
    if (!data) return
    const map = {}
    data.forEach(p => {
      const key = p.dining_item_id ? `${p.dining_id}-item-${p.dining_item_id}` : p.dining_id
      if (!map[key]) map[key] = []
      map[key].push(p)
    })
    setPhotos(map)
  }

  async function handleAddPhotos(files, diningId, itemId = null) {
    const key = itemId ? `${diningId}-item-${itemId}` : diningId
    setUploadingKey(key)
    try {
      const folder = itemId ? `dining/${diningId}/items` : `dining/${diningId}`
      const newPhotos =[]
      for (const file of files) {
        const { filePath, url } = await uploadPhoto(supabase, file, folder)
        const { data } = await supabase.from('dining_photos').insert({
          dining_id: diningId, dining_item_id: itemId || null, file_path: filePath, url
        }).select().single()
        if (data) newPhotos.push(data)
      }
      setPhotos(prev => ({ ...prev, [key]: [...(prev[key] ||[]), ...newPhotos] }))
    } catch (e) { alert('上传失败：' + e.message) }
    setUploadingKey(null)
  }

  async function handleDeletePhoto(photo) {
    try {
      await deletePhoto(supabase, photo.file_path)
      await supabase.from('dining_photos').delete().eq('id', photo.id)
      const key = photo.dining_item_id ? `${photo.dining_id}-item-${photo.dining_item_id}` : photo.dining_id
      setPhotos(prev => ({ ...prev, [key]: (prev[key] ||[]).filter(p => p.id !== photo.id) }))
    } catch (e) { alert('删除失败：' + e.message) }
  }

  function confirmDeleteRecord(record) {
    // 检查是否有可回退的食材
    const rollbackItems = (record.dining_items || []).filter(i => i.ingredient_id && i.update_consumed && getDiningItemConsumedQty(i) > 0)
    const hasRollback = record.dining_type === 'home' && rollbackItems.length > 0
    const rollbackSummary = hasRollback
      ? rollbackItems.map(i => `・${i.name_zh} ${formatDiningItemQty(i)}`).join('\n')
      : ''
    setDeleteConfirm({ record, hasRollback, rollbackSummary })
  }

  async function deleteRecordWithRollback(record, alsoRollback) {
    if (!record || deletingRecord) return
    setDeletingRecord(true)

    try {
      if (alsoRollback) {
        const rollbackItems = (record.dining_items || []).filter(i => i.ingredient_id && i.update_consumed && getDiningItemConsumedQty(i) > 0)
        if (rollbackItems.length > 0) {
          const rollbackByIngredient = rollbackItems.reduce((map, item) => {
            const key = String(item.ingredient_id)
            map.set(key, (map.get(key) || 0) + getDiningItemConsumedQty(item))
            return map
          }, new Map())
          const ingredientIds = [...rollbackByIngredient.keys()]
          const freshIngredients = await fetchIngredientsByIds(ingredientIds)
          const clipWarnings = []

          for (const ingredient of freshIngredients) {
            const rollbackQty = rollbackByIngredient.get(String(ingredient.id)) || 0
            const currentConsumed = Number(ingredient.consumed_quantity) || 0
            const totalQty = Number(ingredient.quantity) || 0
            const desiredConsumed = parseFloat((currentConsumed - rollbackQty).toFixed(2))
            const newConsumed = Math.min(totalQty, Math.max(0, desiredConsumed))

            if (newConsumed !== desiredConsumed) {
              if (desiredConsumed < 0) {
                clipWarnings.push(`・${ingredient.name_zh}：回退后库存消耗量不能为负，已设为 0（原计算值为 ${desiredConsumed}）`)
              } else if (desiredConsumed > totalQty) {
                clipWarnings.push(`・${ingredient.name_zh}：回退后库存消耗量不能超过总数 ${totalQty}${ingredient.unit}，已设为 ${totalQty}${ingredient.unit}（原计算值为 ${desiredConsumed}）`)
              }
            }

            const isFullyConsumed = totalQty > 0 && newConsumed >= totalQty
            await supabase.from('ingredients').update({ consumed_quantity: newConsumed }).eq('id', ingredient.id)
            if (ingredient.purchase_item_id) {
              await supabase.from('purchase_items').update({
                consumed_quantity: newConsumed,
                is_fully_consumed: isFullyConsumed
              }).eq('id', ingredient.purchase_item_id)
            }
          }

          if (clipWarnings.length > 0) {
            window.alert(`⚠️ 以下食材库存调整时已被自动限制到合理范围：\n\n${clipWarnings.join('\n')}`)
          }
        }
      }

      const { error } = await supabase.from('dining_history').delete().eq('id', record.id)
      if (error) { alert('删除失败：' + error.message); return }

      setRecords(records.filter(r => r.id !== record.id))
    } catch (e) {
      alert('删除失败：' + e.message)
    } finally {
      setDeletingRecord(false)
      setDeleteConfirm(null)
    }
  }

  function handleSaveMemo(itemId, memo) {
    setRecords(records.map(r => ({
      ...r,
      dining_items: r.dining_items?.map(i => i.id === itemId ? { ...i, memo } : i)
    })))
  }

  const filtered = records.filter(r => {
    if (filterType !== 'all' && r.dining_type !== filterType) return false
    if (dateFilter) {
      const itemDate = r.dined_at || r.created_at
      if (!itemDate || itemDate.slice(0, 10) !== dateFilter) return false
    }
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

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>🍽️ 餐饮履历</h1>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>共 {filtered.length} 条</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={settings.display_currency || 'JPY'}
            onChange={async e => await saveSetting('display_currency', e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 7, fontSize: 12, border: '1px solid #e2e8f0', color: '#475569', background: '#fff' }}>
            {(settings.exchange_rates || []).map(r => (
              <option key={r.to} value={r.to}>{r.symbol} {r.to}</option>
            ))}
          </select>
          <button onClick={() => setShowAdd(true)} style={{ padding: '7px 16px', borderRadius: 10, background: '#f97316', color: '#fff', fontSize: 14, fontWeight: 600 }}>+ 记录</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: '#94a3b8', pointerEvents: 'none' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索店名、食材..."
            style={{ width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10, fontSize: 14, border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff', boxSizing: 'border-box' }} />
          {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', color: '#94a3b8', fontSize: 18, lineHeight: 1 }}>×</button>}
        </div>
        <label style={{ width: 42, flexShrink: 0, cursor: 'pointer', display: 'block', position: 'relative', overflow: 'hidden' }}>
          <span style={{
            width: 42, height: 42, borderRadius: 10, fontSize: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: dateFilter ? '1.5px solid #f97316' : '1.5px solid #e2e8f0',
            background: dateFilter ? '#fff7ed' : '#fff'
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
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
        gap: 5, marginBottom: 14,
        background: '#f1f5f9', borderRadius: 10, padding: 3
      }}>
        {[['all','全部'],['home','🍳 自炊'],['out','🍽️ 外食']].map(([id, label]) => (
          <button key={id} onClick={() => setFilterType(id)} style={{
            padding: '7px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: filterType === id ? '#fff' : 'transparent',
            color: filterType === id
              ? (id === 'home' ? '#16a34a' : id === 'out' ? '#f97316' : '#334155')
              : '#94a3b8',
            boxShadow: filterType === id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
          }}>{label}</button>
        ))}
      </div>
      {loading ? (
        <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>加载中...</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>
          {search ? '没有找到匹配的记录' : '暂无餐饮记录，点击右上角开始记录'}
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
            const yearRecords = Object.values(months).flatMap(m => Object.values(m).flat())
            const yearOutTotal = yearRecords.filter(r => r.dining_type === 'out').reduce((s, r) => s + (r.amount || 0), 0)
            const yearHomeTotal = yearRecords.filter(r => r.dining_type === 'home').reduce((s, r) => s + getDiningRecordHomeCost(r), 0)
            const isYearCollapsed = collapsedYears[year] ?? (!isFiltering && year !== currentYear)

            return (
              <div key={year} style={{ border: '1px solid #f1f5f9', borderRadius: 12, overflow: 'hidden' }}>
                <div onClick={() => setCollapsedYears(c => ({ ...c, [year]: !c[year] }))}
                  style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f8fafc' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#334155' }}>{year}</span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>{yearRecords.length} 条</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {yearHomeTotal > 0 && <span style={{ fontSize: 12, color: '#16a34a' }}>自炊 {formatAmount(yearHomeTotal, settings)}</span>}
                    {yearOutTotal > 0 && <span style={{ fontSize: 12, color: '#f97316' }}>外食 {formatAmount(yearOutTotal, settings)}</span>}
                    <span style={{ fontSize: 14, color: '#94a3b8' }}>{isYearCollapsed ? '▼' : '▲'}</span>
                  </div>
                </div>

                {!isYearCollapsed && (
                  <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {Object.entries(months).map(([month, days]) => {
                      const monthRecords = Object.values(days).flat()
                      const monthOutTotal = monthRecords.filter(r => r.dining_type === 'out').reduce((s, r) => s + (r.amount || 0), 0)
                      const monthHomeTotal = monthRecords.filter(r => r.dining_type === 'home').reduce((s, r) => s + getDiningRecordHomeCost(r), 0)
                      const monthKey = `${year}-${month}`
                      const isMonthCollapsed = collapsedMonths[monthKey] ?? (month !== latestMonth && !isFiltering)

                      return (
                        <div key={month}>
                          <div onClick={() => setCollapsedMonths(c => ({ ...c, [monthKey]: !c[monthKey] }))}
                            style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isMonthCollapsed ? 0 : 8, paddingBottom: 6, borderBottom: '1.5px solid #f1f5f9' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>{month}</span>
                              <span style={{ fontSize: 12, color: '#94a3b8' }}>{monthRecords.length} 条</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {monthHomeTotal > 0 && <span style={{ fontSize: 12, color: '#16a34a' }}>自炊 {formatAmount(monthHomeTotal, settings)}</span>}
                              {monthOutTotal > 0 && <span style={{ fontSize: 12, color: '#f97316' }}>外食 {formatAmount(monthOutTotal, settings)}</span>}
                              <span style={{ fontSize: 13, color: '#94a3b8' }}>{isMonthCollapsed ? '▼' : '▲'}</span>
                            </div>
                          </div>

                          {!isMonthCollapsed && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              {Object.entries(days).sort(([a],[b]) => b.localeCompare(a)).map(([day, dayRecords]) => (
                                <div key={day}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                                    {new Date(day).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })}
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {[...dayRecords].sort((a, b) => (mealOrder[a.meal_time] ?? 4) - (mealOrder[b.meal_time] ?? 4)).map(r => {
                                      const displayHomeCost = getDiningRecordHomeCost(r)
                                      return (
                                      <div key={r.id} style={{
                                        background: '#fff', borderRadius: 12, overflow: 'hidden',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                                        borderLeft: `4px solid ${r.dining_type === 'home' ? '#16a34a' : '#f97316'}`
                                      }}>
                                        <div style={{ padding: '12px 14px' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setExpanded(e => ({ ...e, [r.id]: !e[r.id] }))}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {r.meal_time && <><span style={{ fontSize: 16 }}>{mealIcon[r.meal_time]}</span><span style={{ fontWeight: 600, fontSize: 14 }}>{mealLabel[r.meal_time]}</span></>}
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
                                                  {r.amount && <span style={{ marginLeft: 8, fontWeight: 600, color: '#f97316' }}>{formatAmount(r.amount, settings)}</span>}
                                                </div>
                                              )}
                                              {r.dining_type === 'home' && displayHomeCost > 0 && (
                                                <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, marginTop: 4 }}>
                                                  成本 {formatAmount(displayHomeCost, settings)}
                                                </div>
                                              )}
                                              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                                                {r.dining_items?.length > 0 ? `${r.dining_items.length} ${r.dining_type === 'home' ? '种食材' : '道菜品'}` : '无明细'}
                                                {(photos[r.id]?.length > 0) && ` · 📷 ${photos[r.id].length} 张`}
                                              </div>
                                              {r.memo && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>备注：{r.memo}</div>}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                              <button onClick={() => setEditingRecord(r)} style={{ background: '#f1f5f9', color: '#475569', fontSize: 13, padding: '5px 10px', borderRadius: 7, fontWeight: 600 }}>编辑</button>
                                              <button onClick={e => { e.stopPropagation(); confirmDeleteRecord(r) }} style={{ background: '#fef2f2', color: '#ef4444', fontSize: 13, padding: '5px 10px', borderRadius: 7, fontWeight: 600 }}>删除</button>
                                              <div onClick={() => setExpanded(e => ({ ...e, [r.id]: !e[r.id] }))} style={{ fontSize: 16, color: '#94a3b8', cursor: 'pointer', padding: '0 4px' }}>
                                                {expanded[r.id] ? '▲' : '▼'}
                                              </div>
                                            </div>
                                          </div>
                                        </div>

                                        {expanded[r.id] && (
                                          <div style={{ borderTop: '1px solid #f1f5f9' }}>
                                            <div style={{ padding: '10px 14px', borderBottom: '1px solid #f8fafc' }}>
                                              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>餐饮照片</div>
                                              <PhotoViewer
                                                photos={photos[r.id] ||[]}
                                                onAdd={files => handleAddPhotos(files, r.id)}
                                                onDelete={handleDeletePhoto}
                                                uploading={uploadingKey === r.id}
                                              />
                                            </div>

                                            {r.dining_items?.map((item, idx) => (
                                              <div key={idx} style={{
                                                padding: '10px 14px', borderBottom: '1px solid #f8fafc',
                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer'
                                              }} onClick={() => setDetailItem({ item, diningId: r.id })}>
                                                <div style={{ flex: 1 }}>
                                                  <div style={{ fontSize: 14, fontWeight: 500 }}>{item.name_zh}</div>
                                                  {item.memo && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>备注：{item.memo}</div>}
                                                  {(photos[`${r.id}-item-${item.id}`]?.length > 0) && (
                                                    <div style={{ fontSize: 11, color: '#f97316', marginTop: 2 }}>📷 {photos[`${r.id}-item-${item.id}`].length} 张照片</div>
                                                  )}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                  <div style={{ textAlign: 'right', fontSize: 13 }}>
                                                    {r.dining_type === 'home' ? (
                                                      <div style={{ color: '#64748b' }}>{item.consumed_quantity || item.quantity}{item.unit}</div>
                                                    ) : (
                                                      <>
                                                        <div style={{ color: '#64748b' }}>{item.quantity}{item.unit}</div>
                                                        {item.price && (
                                                          <div style={{ fontWeight: 600, color: '#f97316' }}>
                                                            {item.quantity > 1 && <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 4 }}>{formatAmount(item.price, settings)}×{item.quantity}</span>}
                                                            {formatAmount(Number(item.price) * Number(item.quantity), settings)}
                                                          </div>
                                                        )}
                                                      </>
                                                    )}
                                                    {getDiningItemCost(item) > 0 && r.dining_type === 'home' && (
                                                      <div style={{ fontSize: 11, color: '#16a34a' }}>{formatAmount(getDiningItemCost(item), settings)}</div>
                                                    )}
                                                  </div>
                                                  <span style={{ fontSize: 16, color: '#94a3b8' }}>›</span>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      )
                                    })}
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
          })
        })()}
        </div>
      )}


      {deleteConfirm && (
        <ConfirmModal
          title="删除餐饮记录"
          message={deleteConfirm.hasRollback
            ? `确定要删除这条${deleteConfirm.record.dining_type === 'home' ? '自炊' : '外食'}记录吗？删除后无法恢复。\n\n检测到以下食材曾同步消耗量，是否同时回退库存？\n${deleteConfirm.rollbackSummary}`
            : `确定要删除这条${deleteConfirm.record.dining_type === 'home' ? '自炊' : '外食'}记录吗？删除后无法恢复。`}
          confirmText={deleteConfirm.hasRollback ? '是，删除并回退库存' : '确认删除'}
          cancelText={deleteConfirm.hasRollback ? '否，仅删除记录' : '取消'}
          cancelExtraText={deleteConfirm.hasRollback ? '取消' : undefined}
          confirmColor={deleteConfirm.hasRollback ? '#16a34a' : '#ef4444'}
          onConfirm={async () => {
            await deleteRecordWithRollback(deleteConfirm.record, deleteConfirm.hasRollback)
          }}
          onCancel={() => {
            if (deleteConfirm.hasRollback) {
              deleteRecordWithRollback(deleteConfirm.record, false)
            } else {
              setDeleteConfirm(null)
            }
          }}
          onCancelExtra={deleteConfirm.hasRollback ? () => setDeleteConfirm(null) : undefined}
        />
      )}

      {showAdd && <AddDiningModal onClose={() => setShowAdd(false)} onSaved={fetchRecords} />}
      {editingRecord && <EditDiningModal record={editingRecord} onClose={() => setEditingRecord(null)} onSaved={() => { fetchRecords(); setEditingRecord(null) }} />}
      {detailItem && (
        <DishDetailModal
          item={detailItem.item}
          diningId={detailItem.diningId}
          photos={photos}
          onAddPhotos={handleAddPhotos}
          onDeletePhoto={handleDeletePhoto}
          uploading={uploadingKey === `${detailItem.diningId}-item-${detailItem.item.id}`}
          onClose={() => setDetailItem(null)}
          onSaveMemo={handleSaveMemo}
        />
      )}
      {selectingIngredients && (
        <IngredientSelectModal
          diningId={selectingIngredients.diningId}
          dinedAt={selectingIngredients.dinedAt}
          mealTime={selectingIngredients.mealTime}
          existingItems={selectingIngredients.existingItems}
          onClose={() => setSelectingIngredients(null)}
          onSaved={fetchRecords}
        />
      )}
    </div>
  )
}
