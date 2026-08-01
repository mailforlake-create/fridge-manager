-- 餐饮履历数据加载优化 - 索引迁移
-- 执行时间：2026-08-01
-- 说明：为餐饮履历页面及相关页面的查询链路添加索引
-- 所有索引均使用 IF NOT EXISTS，可安全重复执行

-- ============ dining_history（餐饮记录主表） ============

-- 主查询排序：dined_at DESC, created_at DESC（fetchRecords）
CREATE INDEX IF NOT EXISTS idx_dining_history_dined_at_created_at
  ON dining_history (dined_at DESC, created_at DESC);

-- 类型过滤：filterType 筛选 home/out
CREATE INDEX IF NOT EXISTS idx_dining_history_dining_type
  ON dining_history (dining_type);


-- ============ dining_items（餐饮明细） ============

-- 关联 dining_history（主查询嵌入 dining_items）
CREATE INDEX IF NOT EXISTS idx_dining_items_dining_id
  ON dining_items (dining_id);

-- 关联 ingredients（dining_items 嵌入 ingredient）
CREATE INDEX IF NOT EXISTS idx_dining_items_ingredient_id
  ON dining_items (ingredient_id);


-- ============ dining_photos（餐饮照片） ============

-- fetchPhotos 用 dining_id IN (...) 批量查询
CREATE INDEX IF NOT EXISTS idx_dining_photos_dining_id
  ON dining_photos (dining_id);

-- 关联 dining_items（菜品照片）
CREATE INDEX IF NOT EXISTS idx_dining_photos_dining_item_id
  ON dining_photos (dining_item_id);


-- ============ ingredients（食材） ============

-- 多个弹窗（记录餐饮/编辑/追加食材）按 created_at DESC 排序加载
CREATE INDEX IF NOT EXISTS idx_ingredients_created_at
  ON ingredients (created_at DESC);

-- 关联 purchase_items（ingredients 嵌入 purchase_item 获取价格）
CREATE INDEX IF NOT EXISTS idx_ingredients_purchase_item_id
  ON ingredients (purchase_item_id);


-- ============ purchase_items（购买明细） ============

-- 关联 purchase_history（purchase_items 嵌入 purchase_history 获取店名/购买日期）
CREATE INDEX IF NOT EXISTS idx_purchase_items_history_id
  ON purchase_items (history_id);