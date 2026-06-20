export default function ConfirmModal({ title, message, onConfirm, onCancel, onCancelExtra, confirmText = '确认', cancelText = '取消', cancelExtraText, confirmColor = '#ef4444' }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 3000, padding: 24
    }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 360 }}>
        {title && <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>{title}</div>}
        {message && <div style={{ fontSize: 14, color: '#64748b', marginBottom: 20, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{message}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {onConfirm && (
            <button onClick={onConfirm} style={{
              padding: '11px 0', borderRadius: 10, background: confirmColor,
              color: '#fff', fontSize: 15, fontWeight: 700
            }}>{confirmText}</button>
          )}
          {onCancel && (
            <button onClick={onCancel} style={{
              padding: '11px 0', borderRadius: 10, background: '#f1f5f9',
              color: '#475569', fontSize: 15, fontWeight: 600
            }}>{cancelText}</button>
          )}
          {onCancelExtra && (
            <button onClick={onCancelExtra} style={{
              padding: '11px 0', borderRadius: 10, background: '#fff',
              color: '#94a3b8', fontSize: 14, border: '1px solid #e2e8f0'
            }}>{cancelExtraText || '取消'}</button>
          )}
        </div>
      </div>
    </div>
  )
}
