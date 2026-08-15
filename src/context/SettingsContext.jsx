import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  FOOD_CATEGORIES, DAILY_CATEGORIES, UNITS, DAILY_UNITS, LOCATIONS, DAILY_LOCATIONS
} from '../lib/categories'

const DEFAULT_EXCHANGE_RATES = [
  { to: 'JPY', label: '日元', rate: 1, symbol: '¥' },
  { to: 'CNY', label: '人民币', rate: 0.05, symbol: '¥' },
  { to: 'USD', label: '美元', rate: 0.0067, symbol: '$' },
]

const defaults = {
  food_categories: FOOD_CATEGORIES,
  daily_categories: DAILY_CATEGORIES,
  food_units: UNITS,
  daily_units: DAILY_UNITS,
  food_locations: LOCATIONS,
  daily_locations: DAILY_LOCATIONS,
  item_consume_step: 0.1,
  dining_qty_step: 1,
  display_currency: 'JPY',
  exchange_rates: DEFAULT_EXCHANGE_RATES,
}

const INVALID_LIST_VALUES = new Set(['分类', '选择分类'])

function normalizeList(list) {
  return [...new Set((list || [])
    .map(item => (typeof item === 'string' ? item.trim() : item))
    .filter(item => item && !INVALID_LIST_VALUES.has(item))
  )]
}

function normalizeExchangeRates(rates) {
  const source = Array.isArray(rates) && rates.length > 0 ? rates : defaults.exchange_rates
  const normalized = source
    .filter(rate => rate?.to)
    .map(rate => ({
      ...rate,
      rate: Number(rate.rate) || 1,
      symbol: rate.symbol || '¥',
      label: rate.label || rate.to,
    }))

  if (!normalized.some(rate => rate.to === 'JPY')) {
    normalized.unshift(DEFAULT_EXCHANGE_RATES[0])
  }

  return normalized
}

function normalizeSettings(raw) {
  const exchangeRates = normalizeExchangeRates(raw.exchange_rates)
  return {
    ...raw,
    food_categories: normalizeList(raw.food_categories || defaults.food_categories),
    daily_categories: normalizeList(raw.daily_categories || defaults.daily_categories),
    food_units: normalizeList(raw.food_units || defaults.food_units),
    daily_units: normalizeList(raw.daily_units || defaults.daily_units),
    item_consume_step: Math.min(10, Math.max(0.01, Number(raw.item_consume_step) || defaults.item_consume_step)),
    dining_qty_step: Math.min(10, Math.max(0.01, Number(raw.dining_qty_step) || defaults.dining_qty_step)),
    display_currency: raw.display_currency || defaults.display_currency,
    exchange_rates: exchangeRates,
  }
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
      setSettings(prev => normalizeSettings({ ...prev, ...map }))
    }
    setLoading(false)
  }

  async function saveSetting(key, value) {
    await supabase.from('settings').upsert({ key, value, updated_at: new Date().toISOString() })
    setSettings(prev => normalizeSettings({ ...prev, [key]: value }))
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
