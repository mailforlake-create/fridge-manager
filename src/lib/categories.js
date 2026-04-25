export const FOOD_CATEGORIES = [
  '蔬菜','水果','肉类','海鲜','乳制品','饮料','调味料','冷冻食品','零食','其他'
]

export const DAILY_CATEGORIES = [
  '清洁用品','洗护用品','厨房用品','纸品','药品','文具','日用杂货'
]

export const ALL_CATEGORIES = [
  ...FOOD_CATEGORIES,
  ...DAILY_CATEGORIES
]

export function isDailyCategory(category) {
  return DAILY_CATEGORIES.includes(category)
}