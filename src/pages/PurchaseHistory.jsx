import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import DiningHistory from './DiningHistory'
import { recognizeReceipt } from '../lib/aiRecognition'
import { FOOD_CATEGORIES, DAILY_CATEGORIES, isDailyCategory } from '../lib/categories'

function calcExpiry(mfgDate, shelfDays) {
  if (!mfgDate || !shelfDays) return ''
  const d = new Date(mfgDate)
  d.setDate(d.getDate() + Number(shelfDays))
  return d.toISOString().split('T')[0]
}

const UNITS = ['个','包','瓶','袋','克','毫升','升','根','片','块']
const CATEGORIES = ['蔬菜','水果','肉类','海鲜','乳制品','饮料','调味料','冷冻食品','零食','其他','非食材']

const smallField = {
  width: '100%', padding: '6px 8px', borderRadius: 7, fontSize: 13,
  border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
}

function ItemDetailModal({ item, onClose }) {
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
            ['实付价格', item.price ? `¥${item.price}` : null],
            ['原价', item.original_price ? `¥${item.original_price}` : null],
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

function ReceiptScanModal({ onClose, onSaved }) {
  const [aiItems, setAiItems] = useState([])
  const [selected, setSelected] = useState({})
  const [receiptData, setReceiptData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const UNITS = ['个','包','瓶','袋','克','毫升','升','根','片','块']
  const ALL_CATS = [...FOOD_CATEGORIES, ...DAILY_CATEGORIES]

  const smallField = {
    width: '100%', padding: '6px 8px', borderRadius: 7, fontSize: 13,
    border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
  }

  const setItemField = useCallback((i, k, v) => {
    setAiItems(items => { const n = [...items]; n[i] = { ...n[i], [k]: v }; return n })
  }, [])

  async function handleFile(file) {
    setLoading(true)
    try {
      const data = await recognizeReceipt(file)
      if (data && data.items) {
        setReceiptData(data)
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
      const { data: history } = await supabase
        .from('purchase_history')
        .insert({
          store_name: receiptData.store_name || '未知商家',
          store_name_original: receiptData.store_name_original || null,
          purchased_at: receiptData.purchased_at || null,
          total_amount: receiptData.total_amount || null
        }).select().single()

      if (history) {
        const historyItems = aiItems.map((item, i) => ({
          history_id: history.id,
          name_zh: item.name_zh,
          name_original: item.name_original || null,
          category: item.category || null,
          quantity: Number(item.quantity) || 1,
          unit: item.unit || '个',
          price: item.price || null,
          original_price: item.original_price || null,
          is_discount: item.is_discount || false,
          discount_info: item.discount_info || null,
          add_to_fridge: selected[i] && !isDailyCategory(item.category) && item.category !== '非食材',
          expiry_date: item.expiry_date || null,
          memo: item.memo || null,
        }))
        const { data: savedItems } = await supabase.from('purchase_items').insert(historyItems).select()

        // 食品入库
        const fridgeItems = aiItems.filter((item, i) =>
          selected[i] && !isDailyCategory(item.category) && item.category !== '非食材'
        )
        for (const item of fridgeItems) {
          const savedItem = savedItems?.find(s => s.name_zh === item.name_zh)
          await supabase.from('ingredients').insert({
            name_zh: item.name_zh,
            name_original: item.name_original || null,
            category: item.category || null,
            quantity: Number(item.quantity) || 1,
            unit: item.unit || '个',
            expiry_date: item.expiry_date || null,
            memo: item.memo || null,
            location: 'fridge',
            purchase_item_id: savedItem?.id || null
          })
        }

        // 日用品入库
        const dailyItems = aiItems.filter((item, i) =>
          selected[i] && isDailyCategory(item.category)
        )
        for (const item of dailyItems) {
          const savedItem = savedItems?.find(s => s.name_zh === item.name_zh)
          await supabase.from('daily_items').insert({
            name_zh: item.name_zh,
            name_original: item.name_original || null,
            category: item.category || null,
            quantity: Number(item.quantity) || 1,
            unit: item.unit || '个',
            location: 'home',
            memo: item.memo || null,
            purchase_item_id: savedItem?.id || null
          })
          // 更新 purchase_items 的 add_to_fridge
          if (savedItem) {
            await supabase.from('purchase_items').update({ add_to_fridge: true }).eq('id', savedItem.id)
          }
        }
      }
      onSaved()
      onClose()
    } catch (e) {
      alert('保存失败：' + e.message)
    }
    setSaving(false)
  }

  return (
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
              <div style={{ fontWeight: 600, color: '#16a34a' }}>{receiptData.store_name || '未知商家'}</div>
              <div style={{ color: '#64748b', marginTop: 2 }}>
                {receiptData.purchased_at && `购买日期：${receiptData.purchased_at}　`}
                {receiptData.total_amount && `合计：¥${receiptData.total_amount}`}
              </div>
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
                          <optgroup label="食品">
                            {FOOD_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                          </optgroup>
                          <optgroup label="日用品">
                            {DAILY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                          </optgroup>
                          <option value="非食材">非食材（不入库）</option>
                        </select>
                        {isDailyCategory(item.category) && (
                          <span style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600, whiteSpace: 'nowrap' }}>→日用品</span>
                        )}
                        {item.price && (
                          <span style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                            {item.is_discount && <span style={{ color: '#ef4444' }}>折扣 </span>}
                            ¥{item.price}
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
              <button onClick={() => { setReceiptData(null); setAiItems([]); setSelected({}) }} style={{
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
  )
}

function ManualReceiptModal({ onClose, onSaved }) {
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

  const UNITS = ['个','包','瓶','袋','克','毫升','升','根','片','块']
  const CATEGORIES = ['蔬菜','水果','肉类','海鲜','乳制品','饮料','调味料','冷冻食品','零食','其他','非食材']

  const smallField = {
    width: '100%', padding: '6px 8px', borderRadius: 7, fontSize: 13,
    border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
  }
  const field = {
    width: '100%', padding: '9px 12px', borderRadius: 9, fontSize: 14,
    border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff'
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

      const historyItems = validItems.map(item => ({
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

      const { data: savedItems, error: itemsError } = await supabase
        .from('purchase_items')
        .insert(historyItems)
        .select()

      if (itemsError) { console.error('商品保存失败：', itemsError); alert('保存失败：' + itemsError.message); setSaving(false); return }

      // 入库到 ingredients
      const fridgeItems = validItems.filter(item =>
        item.add_to_fridge && item.category !== '非食材'
      )

      for (const item of fridgeItems) {
        const savedItem = savedItems?.find(s => s.name_zh === item.name_zh)
        const { error: ingError } = await supabase.from('ingredients').insert({
          name_zh: item.name_zh,
          name_original: item.name_original || null,
          category: item.category || null,
          quantity: Number(item.quantity) || 1,
          unit: item.unit || '个',
          expiry_date: item.expiry_date || null,
          memo: item.memo || null,
          location: 'fridge',
          purchase_item_id: savedItem?.id || null
        })
        if (ingError) console.error('入库失败：', item.name_zh, ingError)
      }

      console.log('保存成功')
      onSaved()
      onClose()
    } catch (e) {
      console.error('保存异常：', e)
      alert('保存失败：' + e.message)
    }
    setSaving(false)
  }

  return (
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

        {/* 小票头部信息 */}
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

        {/* 商品列表 */}
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
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={item.add_to_fridge}
                    onChange={e => setItemField(i, 'add_to_fridge', e.target.checked)}
                    style={{ width: 15, height: 15, accentColor: '#16a34a' }} />
                  <span style={{ fontSize: 12, color: '#475569' }}>入库到物品</span>
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
  )
}

export default function PurchaseHistory() {
  const [showManualAdd, setShowManualAdd] = useState(false)
  const [history, setHistory] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingItem, setEditingItem] = useState(null)
  const [editingHistory, setEditingHistory] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [detailItem, setDetailItem] = useState(null)
  const [showReceiptScan, setShowReceiptScan] = useState(false)
  const [collapsedYears, setCollapsedYears] = useState({})
  const [collapsedMonths, setCollapsedMonths] = useState({})
  useEffect(() => { fetchHistory() }, [])

  async function fetchHistory() {
    setLoading(true)
    const { data } = await supabase
      .from('purchase_history')
      .select(`*, purchase_items(*)`)
      .order('purchased_at', { ascending: false, nullsFirst: false })
    setHistory(data || [])
    setLoading(false)
  }

  function confirmDeleteHistory(h) {
    setConfirm({
      title: `删除「${h.store_name || '未知商家'}」的购物记录`,
      message: '同时删除已存入冰箱的对应食材？',
      onYes: () => deleteHistory(h, true),
      onNo: () => deleteHistory(h, false),
      onCancel: () => setConfirm(null)
    })
  }

  async function deleteHistory(h, alsoFridge) {
    setConfirm(null)
    if (alsoFridge) {
      const names = h.purchase_items?.filter(i => i.add_to_fridge).map(i => i.name_zh) || []
      for (const name of names) {
        await supabase.from('ingredients').delete().eq('name_zh', name)
      }
    }
    await supabase.from('purchase_history').delete().eq('id', h.id)
    setHistory(history.filter(x => x.id !== h.id))
  }

  function confirmDeleteItem(historyId, item) {
    setConfirm({
      title: `删除「${item.name_zh}」`,
      message: item.add_to_fridge ? '同时删除已存入冰箱的该食材？' : null,
      onYes: item.add_to_fridge ? () => deleteItem(historyId, item, true) : null,
      onNo: item.add_to_fridge ? () => deleteItem(historyId, item, false) : null,
      onConfirm: !item.add_to_fridge ? () => deleteItem(historyId, item, false) : null,
      onCancel: () => setConfirm(null)
    })
  }

  async function deleteItem(historyId, item, alsoFridge) {
    setConfirm(null)
    if (alsoFridge) {
      await supabase.from('ingredients').delete().eq('name_zh', item.name_zh)
    }
    await supabase.from('purchase_items').delete().eq('id', item.id)
    setHistory(history.map(h => h.id === historyId
      ? { ...h, purchase_items: h.purchase_items.filter(i => i.id !== item.id) }
      : h
    ))
  }

  async function saveHistoryEdit() {
    await supabase.from('purchase_history').update({
      store_name: editingHistory.store_name,
      store_name_original: editingHistory.store_name_original,
      purchased_at: editingHistory.purchased_at || null,
      total_amount: editingHistory.total_amount ? Number(editingHistory.total_amount) : null
    }).eq('id', editingHistory.id)
    setHistory(history.map(h => h.id === editingHistory.id ? { ...h, ...editingHistory } : h))
    setEditingHistory(null)
  }

  function confirmSaveItem(item) {
    const orig = editingItem
    if (item.add_to_fridge) {
      setConfirm({
        title: `保存「${item.name_zh}」的修改`,
        message: '同时更新冰箱中的对应食材（含过期日期、备注）？',
        onYes: () => saveItemEdit(orig.historyId, item, true),
        onNo: () => saveItemEdit(orig.historyId, item, false),
        onCancel: () => setConfirm(null)
      })
    } else {
      saveItemEdit(orig.historyId, item, false)
    }
  }

  async function saveItemEdit(historyId, item, alsoFridge) {
    setConfirm(null)
    await supabase.from('purchase_items').update({
      name_zh: item.name_zh,
      name_original: item.name_original,
      category: item.category,
      quantity: Number(item.quantity) || 1,
      unit: item.unit,
      price: item.price || null,
      original_price: item.original_price || null,
      is_discount: item.is_discount,
      discount_info: item.discount_info || null,
      expiry_date: item.expiry_date || null,
      memo: item.memo || null,
    }).eq('id', item.id)

    if (alsoFridge) {
      await supabase.from('ingredients').update({
        name_zh: item.name_zh,
        category: item.category,
        quantity: Number(item.quantity) || 1,
        unit: item.unit,
        expiry_date: item.expiry_date || null,
        memo: item.memo || null,
      }).eq('name_zh', editingItem.original_name_zh)
    }

    setHistory(history.map(h => h.id === historyId
      ? { ...h, purchase_items: h.purchase_items.map(i => i.id === item.id ? item : i) }
      : h
    ))
    setEditingItem(null)
  }

  // ── 过滤 + 按月分组 ───────────────────────────────────────

  const filteredHistory = history.map(h => {
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>🧾 购物履历</h1>
            <span style={{ fontSize: 13, color: '#94a3b8' }}>
              共 {history.length} 张小票
            </span>
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

          {/* 搜索框 */}
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <span style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              fontSize: 16, color: '#94a3b8', pointerEvents: 'none'
            }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索商家、商品名称..."
              style={{
                width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10, fontSize: 14,
                border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff',
                boxSizing: 'border-box'
              }} />
            {search && (
              <button onClick={() => setSearch('')} style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', color: '#94a3b8', fontSize: 18, lineHeight: 1
              }}>×</button>
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
          {/* 确认弹窗 */}
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
                    }}>是，同步操作冰箱</button>
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

          {/* 编辑履历头部弹窗 */}
          {editingHistory && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 999
            }}>
              <div style={{
                background: '#fff', borderRadius: '16px 16px 0 0', padding: 20,
                width: '100%', maxWidth: 430
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
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button onClick={() => setEditingHistory(null)} style={{
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

          {/* 编辑单个商品弹窗 */}
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
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
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
                      <input style={smallField} type="date" value={editingItem.item.expiry_date || ''}
                        onChange={e => setEditingItem(ei => ({ ...ei, item: { ...ei.item, expiry_date: e.target.value } }))} />
                    </div>
                  </div>
                </div>
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
              </div>
            </div>
          )}

          {/* 主列表 */}
          {loading ? (
            <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>加载中...</p>
          ) : filteredHistory.length === 0 ? (
            <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>
              {search ? '没有找到匹配的记录' : '暂无购物记录'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {Object.entries(groupedByYear).map(([year, months]) => {
                const yearTotal = Object.values(months).flat().reduce((sum, h) => sum + (h.total_amount || 0), 0)
                const yearCount = Object.values(months).flat().length
                const isYearCollapsed = collapsedYears[year]

                return (
                  <div key={year} style={{ border: '1px solid #f1f5f9', borderRadius: 12, overflow: 'hidden' }}>
                    {/* 年份标题 */}
                    <div onClick={() => setCollapsedYears(c => ({ ...c, [year]: !c[year] }))}
                      style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f8fafc' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#334155' }}>{year}</span>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>{yearCount} 张小票</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {yearTotal > 0 && (
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#16a34a' }}>¥{yearTotal.toLocaleString()}</span>
                        )}
                        <span style={{ fontSize: 14, color: '#94a3b8' }}>{isYearCollapsed ? '▼' : '▲'}</span>
                      </div>
                    </div>

                    {!isYearCollapsed && (
                      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {Object.entries(months).map(([month, items]) => {
                          const monthTotal = items.reduce((sum, h) => sum + (h.total_amount || 0), 0)
                          const monthKey = `${year}-${month}`
                          const isMonthCollapsed = collapsedMonths[monthKey]

                          return (
                            <div key={month}>
                              {/* 月份标题 */}
                              <div onClick={() => setCollapsedMonths(c => ({ ...c, [monthKey]: !c[monthKey] }))}
                                style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isMonthCollapsed ? 0 : 8, paddingBottom: 6, borderBottom: '1.5px solid #f1f5f9' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>{month}</span>
                                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{items.length} 张小票</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  {monthTotal > 0 && (
                                    <span style={{ fontSize: 13, fontWeight: 600, color: '#16a34a' }}>¥{monthTotal.toLocaleString()}</span>
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
                                                <div style={{ fontWeight: 700, color: '#16a34a' }}>¥{h.total_amount}</div>
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
                                                        <span style={{ fontSize: 11, color: isDailyCategory(item.category) ? '#3b82f6' : '#16a34a', marginLeft: 6 }}>
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
                                                          ¥{item.price}
                                                          {item.is_discount && item.original_price && (
                                                            <span style={{ textDecoration: 'line-through', color: '#94a3b8', fontSize: 11, marginLeft: 4 }}>¥{item.original_price}</span>
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
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}