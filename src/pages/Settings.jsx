import { useState } from 'react'
import { useSettings } from '../context/SettingsContext'

const SECTION_CONFIG = [
  {
    key: 'food_categories',
    label: '食用品分类',
    icon: '🥦',
    type: 'list',
    color: '#16a34a'
  },
  {
    key: 'daily_categories',
    label: '非食用品分类',
    icon: '🧴',
    type: 'list',
    color: '#3b82f6'
  },
  {
    key: 'food_units',
    label: '食用品单位',
    icon: '📏',
    type: 'list',
    color: '#16a34a'
  },
  {
    key: 'daily_units',
    label: '非食用品单位',
    icon: '📐',
    type: 'list',
    color: '#3b82f6'
  },
  {
    key: 'food_locations',
    label: '食用品存放位置',
    icon: '📍',
    type: 'location',
    color: '#16a34a'
  },
  {
    key: 'daily_locations',
    label: '非食用品存放位置',
    icon: '🗂️',
    type: 'location',
    color: '#3b82f6'
  },
]

function ListEditor({ items, onChange, color }) {
  const [newItem, setNewItem] = useState('')

  function add() {
    const val = newItem.trim()
    if (!val || val === '分类' || val === '选择分类' || items.includes(val)) return
    onChange([...items, val])
    setNewItem('')
  }

  function remove(i) {
    onChange(items.filter((_, j) => j !== i))
  }

  function move(i, dir) {
    const arr = [...items]
    const j = i + dir
    if (j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    onChange(arr)
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {items.map((item, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: '#f8fafc', border: '1.5px solid #e2e8f0',
            borderRadius: 8, padding: '4px 8px'
          }}>
            <button onClick={() => move(i, -1)} style={{ background: 'none', color: '#94a3b8', fontSize: 12 }}>←</button>
            <span style={{ fontSize: 13, color: '#334155' }}>{item}</span>
            <button onClick={() => move(i, 1)} style={{ background: 'none', color: '#94a3b8', fontSize: 12 }}>→</button>
            <button onClick={() => remove(i)} style={{ background: 'none', color: '#ef4444', fontSize: 15, lineHeight: 1 }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={newItem} onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="输入新选项后按回车"
          style={{
            flex: 1, padding: '7px 12px', borderRadius: 8, fontSize: 13,
            border: '1.5px solid #e2e8f0', outline: 'none'
          }} />
        <button onClick={add} style={{
          padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: color, color: '#fff'
        }}>添加</button>
      </div>
    </div>
  )
}

function LocationEditor({ items, onChange, color }) {
  const [newKey, setNewKey] = useState('')
  const [newLabel, setNewLabel] = useState('')

  function add() {
    const k = newKey.trim()
    const l = newLabel.trim()
    if (!k || !l) return
    if (items.some(([key]) => key === k)) return alert('ID 已存在')
    onChange([...items, [k, l]])
    setNewKey('')
    setNewLabel('')
  }

  function remove(i) {
    onChange(items.filter((_, j) => j !== i))
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {items.map(([key, label], i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#f8fafc', border: '1.5px solid #e2e8f0',
            borderRadius: 8, padding: '7px 10px'
          }}>
            <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 60 }}>{key}</span>
            <span style={{ fontSize: 13, color: '#334155', flex: 1 }}>{label}</span>
            <button onClick={() => remove(i)} style={{ background: 'none', color: '#ef4444', fontSize: 15, lineHeight: 1 }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={newKey} onChange={e => setNewKey(e.target.value)}
          placeholder="ID (英文)"
          style={{ width: 90, padding: '7px 10px', borderRadius: 8, fontSize: 13, border: '1.5px solid #e2e8f0', outline: 'none' }} />
        <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
          placeholder="显示名称"
          style={{ flex: 1, padding: '7px 10px', borderRadius: 8, fontSize: 13, border: '1.5px solid #e2e8f0', outline: 'none' }} />
        <button onClick={add} style={{
          padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: color, color: '#fff'
        }}>添加</button>
      </div>
    </div>
  )
}

export default function Settings() {
  const { settings, saveSetting } = useSettings()
  const [localSettings, setLocalSettings] = useState(() =>
    JSON.parse(JSON.stringify(settings))
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function update(key, value) {
    setLocalSettings(s => ({ ...s, [key]: value }))
    setSaved(false)
  }

  async function saveAll() {
    setSaving(true)
    for (const key of Object.keys(localSettings)) {
      await saveSetting(key, localSettings[key])
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>⚙️ 设置</h1>
        <button onClick={saveAll} disabled={saving} style={{
          padding: '8px 18px', borderRadius: 10, fontSize: 14, fontWeight: 700,
          background: saved ? '#16a34a' : '#334155', color: '#fff',
          opacity: saving ? 0.7 : 1
        }}>
          {saving ? '保存中...' : saved ? '✓ 已保存' : '保存'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {SECTION_CONFIG.map(section => (
          <div key={section.key} style={{
            background: '#fff', borderRadius: 12,
            border: '1px solid #f1f5f9',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '11px 14px', background: '#f8fafc',
              borderBottom: '1px solid #f1f5f9',
              display: 'flex', alignItems: 'center', gap: 8
            }}>
              <span style={{ fontSize: 18 }}>{section.icon}</span>
              <span style={{ fontWeight: 600, fontSize: 14, color: '#334155' }}>{section.label}</span>
              <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 'auto' }}>
                {section.type === 'location'
                  ? `${localSettings[section.key]?.length || 0} 个`
                  : `${localSettings[section.key]?.length || 0} 项`}
              </span>
            </div>
            <div style={{ padding: '12px 14px' }}>
              {section.type === 'list' ? (
                <ListEditor
                  items={localSettings[section.key] || []}
                  onChange={val => update(section.key, val)}
                  color={section.color}
                />
              ) : (
                <LocationEditor
                  items={localSettings[section.key] || []}
                  onChange={val => update(section.key, val)}
                  color={section.color}
                />
              )}
            </div>
          </div>
        ))}
        {/* AI 配置 */}
        <div style={{
        background: '#fff', borderRadius: 12,
        border: '1px solid #f1f5f9',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        overflow: 'hidden'
        }}>
        <div style={{
            padding: '11px 14px', background: '#f8fafc',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex', alignItems: 'center', gap: 8
        }}>
            <span style={{ fontSize: 18 }}>🤖</span>
            <span style={{ fontWeight: 600, fontSize: 14, color: '#334155' }}>AI 识别配置</span>
        </div>
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* 模型列表 */}
            <div>
            <div style={{ fontSize: 13, color: '#475569', fontWeight: 600, marginBottom: 8 }}>模型列表</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(localSettings.ai_models || []).map((model, i) => (
                <div key={i} style={{
                    background: localSettings.ai_selected_model === model.name ? '#f0fdf4' : '#f8fafc',
                    border: `1.5px solid ${localSettings.ai_selected_model === model.name ? '#16a34a' : '#e2e8f0'}`,
                    borderRadius: 10, padding: '10px 12px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                        onClick={() => update('ai_selected_model', model.name)}
                        style={{
                            width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                            border: `2px solid ${localSettings.ai_selected_model === model.name ? '#16a34a' : '#cbd5e1'}`,
                            background: localSettings.ai_selected_model === model.name ? '#16a34a' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                        {localSettings.ai_selected_model === model.name &&
                            <span style={{ color: '#fff', fontSize: 11 }}>✓</span>}
                        </button>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>{model.name}</span>
                        {localSettings.ai_selected_model === model.name &&
                        <span style={{ fontSize: 11, color: '#16a34a' }}>当前使用</span>}
                    </div>
                    <button
                        onClick={() => {
                        const newModels = (localSettings.ai_models || []).filter((_, j) => j !== i)
                        update('ai_models', newModels)
                        if (localSettings.ai_selected_model === model.name && newModels.length > 0) {
                            update('ai_selected_model', newModels[0].name)
                        }
                        }}
                        style={{ background: '#fef2f2', color: '#ef4444', fontSize: 12, padding: '3px 8px', borderRadius: 6, fontWeight: 600 }}>
                        删除
                    </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>模型名称</div>
                    <input
                        value={model.name}
                        onChange={e => {
                        const newModels = [...(localSettings.ai_models || [])]
                        newModels[i] = { ...newModels[i], name: e.target.value }
                        update('ai_models', newModels)
                        }}
                        style={{ width: '100%', padding: '6px 10px', borderRadius: 7, fontSize: 13, border: '1.5px solid #e2e8f0', outline: 'none', boxSizing: 'border-box' }} />
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, marginBottom: 2 }}>API URL</div>
                    <input
                        value={model.url}
                        onChange={e => {
                        const newModels = [...(localSettings.ai_models || [])]
                        newModels[i] = { ...newModels[i], url: e.target.value }
                        update('ai_models', newModels)
                        }}
                        style={{ width: '100%', padding: '6px 10px', borderRadius: 7, fontSize: 12, border: '1.5px solid #e2e8f0', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }} />
                    </div>
                </div>
                ))}
            </div>

            {/* 添加新模型 */}
            <button
                onClick={() => {
                const newModels = [...(localSettings.ai_models || []), { name: '', url: '' }]
                update('ai_models', newModels)
                }}
                style={{
                marginTop: 10, width: '100%', padding: '8px 0', borderRadius: 8,
                background: '#f1f5f9', color: '#475569', fontSize: 13, fontWeight: 600,
                border: '1px dashed #cbd5e1'
                }}>
                + 添加模型
            </button>
            </div>

            {/* 最大 Token */}
            <div>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 6 }}>最大输出 Token 数</div>
            <input
                type="number"
                value={localSettings.ai_max_tokens || 4096}
                onChange={e => update('ai_max_tokens', Number(e.target.value))}
                style={{
                width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 14,
                border: '1.5px solid #e2e8f0', outline: 'none', boxSizing: 'border-box'
                }} />
            </div>
        </div>
        </div>
      </div>

      <div style={{ height: 40 }} />
    </div>
  )
}
