import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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

export default function PurchaseHistory() {
  const [history, setHistory] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingItem, setEditingItem] = useState(null)
  const [editingHistory, setEditingHistory] = useState(null)
  const [confirm, setConfirm] = useState(null)

  useEffect(() => { fetchHistory() }, [])

  async function fetchHistory() {
    setLoading(true)
    const { data } = await supabase
      .from('purchase_history')
      .select(`*, purchase_items(*)`)
      .order('created_at', { ascending: false })
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

  const filteredHistory = history.map(h => {
  if (!search) return { ...h, matchedItems: null }
  const s = search.toLowerCase()

  // 商家名匹配：显示全部商品
  const storeMatch =
    h.store_name?.toLowerCase().includes(s) ||
    h.store_name_original?.toLowerCase().includes(s) ||
    h.purchased_at?.includes(s)

  if (storeMatch) return { ...h, matchedItems: null }

  // 商品名匹配：只显示匹配的商品
  const matchedItems = h.purchase_items?.filter(i =>
    i.name_zh?.toLowerCase().includes(s) ||
    i.name_original?.toLowerCase().includes(s) ||
    i.memo?.toLowerCase().includes(s)
  )

  if (matchedItems?.length > 0) return { ...h, matchedItems }
  return null
}).filter(Boolean)

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>🧾 购物履历</h1>

      {/* 搜索框 */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <span style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          fontSize: 16, color: '#94a3b8', pointerEvents: 'none'
        }}>🔍</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索商家、商品名称..."
          style={{
            width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10, fontSize: 14,
            border: '1.5px solid #e2e8f0', outline: 'none', background: '#fff',
            boxSizing: 'border-box'
          }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            background: 'none', color: '#94a3b8', fontSize: 18, lineHeight: 1
          }}>×</button>
        )}
      </div>

      {/* 确认弹窗 */}
      {confirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 24
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: 24,
            width: '100%', maxWidth: 360
          }}>
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
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          zIndex: 999
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
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          zIndex: 999
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

              {/* 保质期区域 */}
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

      {loading ? (
        <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>加载中...</p>
      ) : filteredHistory.length === 0 ? (
        <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>
          {search ? '没有找到匹配的记录' : '暂无购物记录'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredHistory.map(h => (
            <div key={h.id} style={{
              background: '#fff', borderRadius: 12, overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
            }}>
              <div style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div onClick={() => setExpanded(e => ({ ...e, [h.id]: !e[h.id] }))}
                    style={{ flex: 1, cursor: 'pointer' }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{h.store_name || '未知商家'}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                      {h.purchased_at || h.created_at?.split('T')[0]}{search && h.matchedItems && (
                        <span style={{ color: '#16a34a', marginLeft: 6 }}>
                          {h.matchedItems.length} 件匹配
                        </span>
                      )}
                      　{h.purchase_items?.length || 0} 件商品
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {h.total_amount && (
                      <div style={{ fontWeight: 700, color: '#16a34a' }}>¥{h.total_amount}</div>
                    )}
                    <button onClick={() => setEditingHistory({ ...h })} style={{
                      background: '#f1f5f9', color: '#475569', fontSize: 13,
                      padding: '5px 10px', borderRadius: 7, fontWeight: 600
                    }}>编辑</button>
                    <button onClick={() => confirmDeleteHistory(h)} style={{
                      background: '#fef2f2', color: '#ef4444', fontSize: 13,
                      padding: '5px 10px', borderRadius: 7, fontWeight: 600
                    }}>删除</button>
                    <div onClick={() => setExpanded(e => ({ ...e, [h.id]: !e[h.id] }))}
                      style={{ fontSize: 16, color: '#94a3b8', cursor: 'pointer', padding: '0 4px' }}>
                      {expanded[h.id] ? '▲' : '▼'}
                    </div>
                  </div>
                </div>
              </div>

              {(expanded[h.id] || (search && h.matchedItems)) && (
                <div style={{ borderTop: '1px solid #f1f5f9' }}>
                  {(h.matchedItems || h.purchase_items)?.map(item => (
                    <div key={item.id} style={{
                      padding: '10px 14px', borderBottom: '1px solid #f8fafc',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 500,
                          color: item.category === '非食材' ? '#94a3b8' : '#1e293b' }}>
                          {item.name_zh}
                          {item.add_to_fridge && (
                            <span style={{ fontSize: 11, color: '#16a34a', marginLeft: 6 }}>已入库</span>
                          )}
                        </div>
                        {item.name_original && (
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.name_original}</div>
                        )}
                        {item.discount_info && (
                          <div style={{ fontSize: 11, color: '#ef4444' }}>{item.discount_info}</div>
                        )}
                        {item.memo && (
                          <div style={{ fontSize: 11, color: '#64748b' }}>备注：{item.memo}</div>
                        )}
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                          {item.quantity}{item.unit}
                          {item.price && (
                            <span style={{ marginLeft: 6, color: item.is_discount ? '#ef4444' : '#475569', fontWeight: 600 }}>
                              ¥{item.price}
                              {item.is_discount && item.original_price && (
                                <span style={{ textDecoration: 'line-through', color: '#94a3b8', fontSize: 11, marginLeft: 4 }}>
                                  ¥{item.original_price}
                                </span>
                              )}
                            </span>
                          )}
                          {item.expiry_date && (
                            <span style={{ marginLeft: 6, color: '#94a3b8' }}>到期 {item.expiry_date}</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => setEditingItem({
                          historyId: h.id,
                          item: { ...item, mfg_date: item.mfg_date || '', shelf_days: item.shelf_days || '' },
                          original_name_zh: item.name_zh
                        })} style={{
                          background: '#f1f5f9', color: '#475569', fontSize: 13,
                          padding: '5px 10px', borderRadius: 7, fontWeight: 600
                        }}>编辑</button>
                        <button onClick={() => confirmDeleteItem(h.id, item)} style={{
                          background: '#fef2f2', color: '#ef4444', fontSize: 13,
                          padding: '5px 10px', borderRadius: 7, fontWeight: 600
                        }}>删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}