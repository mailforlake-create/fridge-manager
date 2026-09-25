import { supabase, batchFetchIn } from './supabase'
import { deletePhoto } from './imageUtils'

const MEAL_LABEL = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '点心' }

/**
 * 查询“删除库存物品”会影响到的自炊消耗明细
 * @param {string[]} ingredientIds 待删除的 ingredients.id
 */
export async function collectConsumptionImpact(ingredientIds) {
  const ids = (ingredientIds || []).filter(Boolean)
  if (!ids.length) return { items: [], ingredientIds: [], diningIds: [], count: 0, summary: '' }
  const items = await batchFetchIn('dining_items', 'ingredient_id', ids,
    'id, dining_id, ingredient_id, name_zh, consumed_quantity, quantity, unit, price_contribution')
  if (!items.length) return { items: [], ingredientIds: ids, diningIds: [], count: 0, summary: '' }
  const diningIds = [...new Set(items.map(i => i.dining_id).filter(Boolean))]
  const histories = await batchFetchIn('dining_history', 'id', diningIds, 'id, dined_at, meal_time, dining_type')
  const historyById = new Map((histories || []).map(h => [String(h.id), h]))
  const enriched = items.map(item => ({ ...item, dining: historyById.get(String(item.dining_id)) || null }))
  const lines = enriched.slice(0, 6).map(item => {
    const h = item.dining || {}
    const qty = Number(item.consumed_quantity || item.quantity || 0)
    return `・${h.dined_at || '未知日期'} ${MEAL_LABEL[h.meal_time] || ''} ${item.name_zh || ''} ${qty}${item.unit || ''}`
  })
  if (enriched.length > lines.length) lines.push(`・…等共 ${enriched.length} 条明细`)
  return { items: enriched, ingredientIds: ids, diningIds, count: enriched.length, summary: lines.join('\n') }
}

async function removePhotoRows(rows) {
  let removed = 0
  for (const photo of rows || []) {
    if (photo.file_path) {
      try { await deletePhoto(supabase, photo.file_path) } catch (e) { console.warn('删除照片文件失败:', e.message) }
    }
    const { error } = await supabase.from('dining_photos').delete().eq('id', photo.id)
    if (!error) removed++
  }
  return removed
}

/**
 * 删除餐饮消耗明细，并重算 / 清理对应餐次
 * @param {string[]} itemIds dining_items.id
 * @param {{ deletePhotos?: boolean, deleteEmptyRecords?: boolean }} options
 */
export async function removeConsumptionDetails(itemIds, options = {}) {
  const ids = (itemIds || []).filter(Boolean)
  const result = { removedItems: 0, removedPhotos: 0, affectedDinings: 0, deletedRecords: 0, updatedCosts: [] }
  if (!ids.length) return result

  const items = await batchFetchIn('dining_items', 'id', ids, 'id, dining_id, price_contribution')
  const diningIds = [...new Set((items || []).map(i => i.dining_id).filter(Boolean))]

  const itemPhotos = await batchFetchIn('dining_photos', 'dining_item_id', ids, 'id, dining_id, file_path')
  if (options.deletePhotos === false) {
    await supabase.from('dining_photos').update({ dining_item_id: null }).in('dining_item_id', ids)
  } else {
    result.removedPhotos += await removePhotoRows(itemPhotos)
  }

  const { error } = await supabase.from('dining_items').delete().in('id', ids)
  if (error) throw new Error('删除消耗明细失败：' + error.message)
  result.removedItems = ids.length
  result.affectedDinings = diningIds.length

  const restItems = diningIds.length
    ? await batchFetchIn('dining_items', 'dining_id', diningIds, 'id, dining_id, price_contribution')
    : []

  for (const diningId of diningIds) {
    const rest = (restItems || []).filter(i => String(i.dining_id) === String(diningId))
    if (rest.length === 0) {
      if (options.deleteEmptyRecords === false) continue
      const photos = await batchFetchIn('dining_photos', 'dining_id', [diningId], 'id, file_path')
      result.removedPhotos += await removePhotoRows(photos)
      await supabase.from('dining_history').delete().eq('id', diningId)
      result.deletedRecords++
      continue
    }
    const cost = Math.round(rest.reduce((sum, i) => sum + (Number(i.price_contribution) || 0), 0) * 10) / 10
    await supabase.from('dining_history').update({ home_cost: cost }).eq('id', diningId)
    result.updatedCosts.push({ diningId, cost })
  }

  return result
}

/**
 * 按 purchase_items 删除库存，并联动清理其消耗明细
 */
export async function removeStockByPurchaseItems(purchaseItemIds) {
  const ids = (purchaseItemIds || []).filter(Boolean)
  if (!ids.length) return { removedIngredients: 0, consumerImpact: null }
  const ingredients = await batchFetchIn('ingredients', 'purchase_item_id', ids, 'id')
  const impact = await collectConsumptionImpact((ingredients || []).map(i => i.id))
  if (impact.items.length) await removeConsumptionDetails(impact.items.map(i => i.id))
  await supabase.from('ingredients').delete().in('purchase_item_id', ids)
  await supabase.from('daily_items').delete().in('purchase_item_id', ids)
  return { removedIngredients: (ingredients || []).length, consumerImpact: impact }
}
