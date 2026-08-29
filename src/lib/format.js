// 数值显示工具：四舍五入到最多指定小数位（仅用于显示，不改变存储的原始数值）

export function formatDecimal(value, maxDecimals = 2) {
  if (value == null || value === '') return value
  const num = Number(value)
  if (!Number.isFinite(num)) return value
  return parseFloat(num.toFixed(maxDecimals))
}
