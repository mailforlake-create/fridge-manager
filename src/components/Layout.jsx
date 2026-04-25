import { Outlet, NavLink } from 'react-router-dom'

export default function Layout() {
  const navStyle = {
    position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
    width: '100%', maxWidth: 430, background: '#fff',
    borderTop: '1px solid #e2e8f0', display: 'flex',
    justifyContent: 'space-around', padding: '8px 0 20px', zIndex: 100
  }
  const linkStyle = ({ isActive }) => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 2, fontSize: 11, color: isActive ? '#16a34a' : '#94a3b8',
    textDecoration: 'none', fontWeight: isActive ? 600 : 400
  })

  return (
    <div style={{ paddingBottom: 80 }}>
      <Outlet />
      <nav style={navStyle}>
        <NavLink to="/fridge" style={linkStyle}>
          <span style={{ fontSize: 22 }}>📦</span>物品
        </NavLink>
        <NavLink to="/history" style={linkStyle}>
          <span style={{ fontSize: 22 }}>🧾</span>履历
        </NavLink>
      </nav>
    </div>
  )
}