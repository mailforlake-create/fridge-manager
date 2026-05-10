import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  FOOD_CATEGORIES, DAILY_CATEGORIES, UNITS, DAILY_UNITS, LOCATIONS, DAILY_LOCATIONS
} from '../lib/categories'

const defaults = {
  food_categories: FOOD_CATEGORIES,
  daily_categories: DAILY_CATEGORIES,
  food_units: UNITS,
  daily_units: DAILY_UNITS,
  food_locations: LOCATIONS,
  daily_locations: DAILY_LOCATIONS,
}

const SettingsContext = createContext(defaults)

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(defaults)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadSettings() }, [])

  async function loadSettings() {
    const { data } = await supabase.from('settings').select('*')
    if (data?.length) {
      const map = {}
      data.forEach(row => { map[row.key] = row.value })
      setSettings(prev => ({ ...prev, ...map }))
    }
    setLoading(false)
  }

  async function saveSetting(key, value) {
    await supabase.from('settings').upsert({ key, value, updated_at: new Date().toISOString() })
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  return (
    <SettingsContext.Provider value={{ settings, loading, saveSetting, reloadSettings: loadSettings }}>
      {!loading && children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}

// 派生工具函数（同 categories.js）
export function isDailyCategory(category, settings) {
  const cats = settings?.daily_categories || DAILY_CATEGORIES
  return cats.includes(category)
}