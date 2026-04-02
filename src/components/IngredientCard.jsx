export default function IngredientCard({ item, onDelete }) {
  const today = new Date()
  const expiry = item.expiry_date ? new Date(item.expiry_date) : null
  const daysLeft = expiry ? Math.ceil((expiry - today) / 86400000) : null

  const statusColor = !daysLeft ? '#94a3b8'
    : daysLeft <= 2 ? '#ef4444'
    : daysLeft <= 7 ? '#f59e0b'
    : '#16a34a'

  const cardStyle = {
    background: '#fff', borderRadius: 12, padding: '12px 14px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderLeft: `4px solid ${statusColor}`,
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
  }

  return (
    <div style={cardStyle}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{item.name_zh}</div>
        {item.name_original && (
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            {item.name_original}
          </div>
        )}
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
          {item.quantity}{item.unit} · {item.category || '未分类'}
        </div>
      </div>
      <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        {daysLeft !== null && (
          <span style={{
            fontSize: 12, fontWeight: 600, color: statusColor,
            background: statusColor + '18', padding: '2px 8px', borderRadius: 99
          }}>
            {daysLeft <= 0 ? '已过期' : `${daysLeft}天`}
          </span>
        )}
        <button onClick={() => onDelete(item.id)} style={{
          fontSize: 18, background: 'none', color: '#cbd5e1', lineHeight: 1
        }}>×</button>
      </div>
    </div>
  )
}