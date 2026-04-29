export const FOOD_CATEGORIES = [
  '蔬菜','水果','肉类','海鲜','乳制品','饮料','调味料','冷冻食品','零食','药品','其他'
]

export const DAILY_CATEGORIES = [
  '清洁用品','洗护用品','厨房用品','纸品','文具','服饰','日用杂货'
]

export const ALL_CATEGORIES = [...FOOD_CATEGORIES, ...DAILY_CATEGORIES]

export const UNITS = ['个','包','瓶','袋','克','毫升','升','根','片','块']

export const DAILY_UNITS = ['个','包','瓶','袋','盒','卷','片','套']

export const LOCATIONS = [
  ['fridge','冰箱'],
  ['freezer','冷冻'],
  ['pantry','常温']
]

export const DAILY_LOCATIONS = [
  ['home','家'],
  ['storage','储物间'],
  ['bathroom','浴室']
]

export function isDailyCategory(category) {
  return DAILY_CATEGORIES.includes(category)
}