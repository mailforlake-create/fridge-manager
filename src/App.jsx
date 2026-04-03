import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Fridge from './pages/Fridge'
import AddIngredient from './pages/AddIngredient'
import ShoppingList from './pages/ShoppingList'
import PurchaseHistory from './pages/PurchaseHistory'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/fridge" replace />} />
          <Route path="fridge" element={<Fridge />} />
          <Route path="add" element={<AddIngredient />} />
          <Route path="shopping" element={<ShoppingList />} />
          <Route path="history" element={<PurchaseHistory />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}