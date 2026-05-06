import { useState } from 'react'

export default function PhotoViewer({ photos, onDelete, onAdd, uploading }) {
  const [preview, setPreview] = useState(null)

  if (!photos) return null

  return (
    <div>
      {/* 缩略图列表 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {photos.map(photo => (
          <div key={photo.id} style={{ position: 'relative' }}>
            <img
              src={photo.url}
              alt=""
              onClick={() => setPreview(photo)}
              style={{
                width: 64, height: 64, objectFit: 'cover',
                borderRadius: 8, cursor: 'pointer',
                border: '1.5px solid #e2e8f0'
              }}
            />
            {onDelete && (
              <button
                onClick={e => {
                  e.stopPropagation()
                  if (window.confirm('确认删除这张照片？')) onDelete(photo)
                }}
                style={{
                  position: 'absolute', top: -6, right: -6,
                  width: 18, height: 18, borderRadius: '50%',
                  background: '#ef4444', color: '#fff',
                  fontSize: 12, lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>×</button>
            )}
          </div>
        ))}

        {/* 上传按钮 */}
        {onAdd && (
          <label style={{
            width: 64, height: 64, borderRadius: 8,
            border: '1.5px dashed #cbd5e1', background: '#f8fafc',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            cursor: uploading ? 'not-allowed' : 'pointer', gap: 2
          }}>
            <input type="file" accept="image/*" multiple style={{ display: 'none' }}
              disabled={uploading}
              onChange={e => { onAdd(Array.from(e.target.files)); e.target.value = '' }} />
            {uploading
              ? <span style={{ fontSize: 10, color: '#94a3b8' }}>上传中</span>
              : <>
                  <span style={{ fontSize: 20, color: '#94a3b8' }}>+</span>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>照片</span>
                </>
            }
          </label>
        )}
      </div>

      {/* 全屏预览 */}
      {preview && (
        <div
          onClick={() => setPreview(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2000, padding: 16
          }}>
          <img
            src={preview.url}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, objectFit: 'contain' }}
          />
          <button
            onClick={() => setPreview(null)}
            style={{
              position: 'absolute', top: 20, right: 20,
              background: 'rgba(255,255,255,0.2)', color: '#fff',
              fontSize: 22, width: 36, height: 36, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>×</button>
          {onDelete && (
            <button
              onClick={e => {
                e.stopPropagation()
                if (window.confirm('确认删除这张照片？')) {
                  onDelete(preview)
                  setPreview(null)
                }
              }}
              style={{
                position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)',
                background: '#ef4444', color: '#fff', padding: '8px 20px',
                borderRadius: 10, fontSize: 14, fontWeight: 600
              }}>删除此照片</button>
          )}
        </div>
      )}
    </div>
  )
}