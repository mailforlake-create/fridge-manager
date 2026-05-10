import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { SettingsProvider } from './context/SettingsContext'
import Layout from './components/Layout'
import Fridge from './pages/Fridge'
import PurchaseHistory from './pages/PurchaseHistory'
import Settings from './pages/Settings'

export default function App() {
  return (
    <SettingsProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/fridge" replace />} />
            <Route path="fridge" element={<Fridge />} />
            <Route path="history" element={<PurchaseHistory />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SettingsProvider>
  )
}