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
    if (!val || items.includes(val)) return
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
      </div>

      <div style={{ height: 40 }} />
    </div>
  )
}