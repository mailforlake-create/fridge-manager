import { useState, useCallback, useRef } from 'react'
import ConfirmModal from './ConfirmModal'

export default function PhotoViewer({ photos, onDelete, onAdd, uploading }) {
  const [previewIndex, setPreviewIndex] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  // 触摸滑动
  const touchStartX = useRef(null)

  const handleTouchStart = useCallback((e) => {
    touchStartX.current = e.touches[0].clientX
  }, [])

  const handleTouchEnd = useCallback((e) => {
    if (touchStartX.current == null) return
    const diff = e.changedTouches[0].clientX - touchStartX.current
    const threshold = 50
    if (diff > threshold && previewIndex > 0) {
      setPreviewIndex(previewIndex - 1)
    } else if (diff < -threshold && previewIndex < photos.length - 1) {
      setPreviewIndex(previewIndex + 1)
    }
    touchStartX.current = null
  }, [previewIndex, photos?.length])

  const handleKeyDown = useCallback((e) => {
    if (previewIndex == null) return
    if (e.key === 'ArrowLeft' && previewIndex > 0) {
      setPreviewIndex(previewIndex - 1)
    } else if (e.key === 'ArrowRight' && previewIndex < photos.length - 1) {
      setPreviewIndex(previewIndex + 1)
    } else if (e.key === 'Escape') {
      setPreviewIndex(null)
    }
  }, [previewIndex, photos?.length])

  if (!photos) return null

  const currentPhoto = previewIndex != null ? photos[previewIndex] : null
  const hasPrev = previewIndex > 0
  const hasNext = previewIndex < photos.length - 1

  return (
    <div>
      {/* 缩略图列表 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {photos.map((photo, index) => (
          <div key={photo.id} style={{ position: 'relative' }}>
            <img
              src={photo.url}
              alt=""
              onClick={() => setPreviewIndex(index)}
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
                  setDeleteConfirm(photo)
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
      {previewIndex != null && currentPhoto && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2000, padding: 0,
            userSelect: 'none'
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onKeyDown={handleKeyDown}
          tabIndex={0}
        >
          {/* 点击遮罩关闭（点击图片本身不关闭） */}
          <div
            style={{ position: 'absolute', inset: 0, zIndex: 0 }}
            onClick={() => setPreviewIndex(null)}
          />

          {/* 左箭头 */}
          {hasPrev && (
            <button
              onClick={e => { e.stopPropagation(); setPreviewIndex(previewIndex - 1) }}
              style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                zIndex: 2,
                width: 44, height: 44, borderRadius: '50%',
                background: 'rgba(255,255,255,0.15)', color: '#fff',
                fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', cursor: 'pointer', backdropFilter: 'blur(4px)'
              }}>‹</button>
          )}

          {/* 图片 */}
          <img
            src={currentPhoto.url}
            alt=""
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: '100%', maxHeight: '100%',
              objectFit: 'contain', position: 'relative', zIndex: 1,
              padding: '40px 60px', boxSizing: 'border-box'
            }}
          />

          {/* 右箭头 */}
          {hasNext && (
            <button
              onClick={e => { e.stopPropagation(); setPreviewIndex(previewIndex + 1) }}
              style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                zIndex: 2,
                width: 44, height: 44, borderRadius: '50%',
                background: 'rgba(255,255,255,0.15)', color: '#fff',
                fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', cursor: 'pointer', backdropFilter: 'blur(4px)'
              }}>›</button>
          )}

          {/* 关闭按钮 */}
          <button
            onClick={e => { e.stopPropagation(); setPreviewIndex(null) }}
            style={{
              position: 'absolute', top: 20, right: 20,
              zIndex: 2,
              background: 'rgba(255,255,255,0.2)', color: '#fff',
              fontSize: 22, width: 36, height: 36, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', cursor: 'pointer'
            }}>×</button>

          {/* 位置指示器 */}
          <div style={{
            position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
            zIndex: 2,
            background: 'rgba(0,0,0,0.5)', color: '#fff',
            padding: '4px 14px', borderRadius: 99,
            fontSize: 13, fontWeight: 600
          }}>
            {previewIndex + 1} / {photos.length}
          </div>

          {/* 删除按钮 */}
          {onDelete && (
            <button
              onClick={e => {
                e.stopPropagation()
                setDeleteConfirm(currentPhoto)
              }}
              style={{
                position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)',
                zIndex: 2,
                background: '#ef4444', color: '#fff', padding: '8px 20px',
                borderRadius: 10, fontSize: 14, fontWeight: 600,
                border: 'none', cursor: 'pointer'
              }}>删除此照片</button>
          )}
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteConfirm && (
        <ConfirmModal
          title="删除照片"
          message="确认删除这张照片？"
          confirmText="确认删除"
          onConfirm={() => {
            onDelete(deleteConfirm)
            setDeleteConfirm(null)
            setPreviewIndex(null)
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  )
}