/**
 * 压缩图片到目标大小（默认 80KB）
 * 返回 Blob
 */
export async function compressImage(file, maxKB = 80) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')

      // 最大尺寸 1200px，保持比例
      const maxSize = 1200
      let { width, height } = img
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round(height * maxSize / width)
          width = maxSize
        } else {
          width = Math.round(width * maxSize / height)
          height = maxSize
        }
      }

      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)

      // 二分法找合适的 quality
      const maxBytes = maxKB * 1024
      let lo = 0.1, hi = 0.9, quality = 0.7
      let blob = null

      const tryQuality = (q) => new Promise(res => {
        canvas.toBlob(b => res(b), 'image/jpeg', q)
      })

      const binarySearch = async () => {
        for (let i = 0; i < 6; i++) {
          quality = (lo + hi) / 2
          blob = await tryQuality(quality)
          if (blob.size <= maxBytes) lo = quality
          else hi = quality
          if (hi - lo < 0.02) break
        }
        // 最终用 lo 保证不超过大小
        blob = await tryQuality(lo)
        resolve(blob)
      }

      binarySearch()
    }
    img.src = url
  })
}

/**
 * 上传图片到 Supabase Storage
 * 返回 { filePath, url }
 */
export async function uploadPhoto(supabase, file, folder = 'dining') {
  const compressed = await compressImage(file)
  const ext = 'jpg'
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { error } = await supabase.storage
    .from('dining-photos')
    .upload(fileName, compressed, { contentType: 'image/jpeg', upsert: false })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from('dining-photos').getPublicUrl(fileName)
  return { filePath: fileName, url: data.publicUrl }
}

/**
 * 删除 Storage 中的图片
 */
export async function deletePhoto(supabase, filePath) {
  const { error } = await supabase.storage.from('dining-photos').remove([filePath])
  if (error) throw new Error(error.message)
}