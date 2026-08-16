// Fallback service worker registration script for deployments where vite-plugin-pwa
// does not emit registerSW.js (e.g. Vite 8 + Rolldown compatibility issues).
let refreshingRef = false

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // 主动检查更新，确保新版本尽快生效（特别是 iPhone Safari/PWA 对 SW 更新检查不可靠）
      if (reg.update) {
        reg.update().catch(() => {})
      }
      // 监听新的 Service Worker 激活并接管页面 → 自动刷新加载新版本
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshingRef) return
        refreshingRef = true
        window.location.reload()
      })
    }).catch(() => {
      // noop: app should still work without offline capabilities
    })
  })
}
