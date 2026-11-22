/**
 * 计算购物履历（purchase_items）应保存的消耗状态。
 *
 * 库存表（daily_items / ingredients）是消耗状态的唯一事实来源：
 * 每次使用物品或修改库存数量后，都用这个函数回写关联的 purchase_items，
 * 避免出现「库存已用完，但小票履历仍显示已入库」的不同步问题。
 *
 * @param {number|string} quantity 库存数量
 * @param {number|string} consumedQuantity 已消耗数量
 * @returns {{consumed_quantity: number, is_fully_consumed: boolean}}
 */
export function getPurchaseConsumptionState(quantity, consumedQuantity) {
  const qty = Number(quantity) || 0
  const consumed = Number(consumedQuantity) || 0
  return {
    consumed_quantity: consumed,
    is_fully_consumed: qty > 0 && consumed >= qty
  }
}
