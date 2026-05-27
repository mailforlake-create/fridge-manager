// Fallback service worker registration script for deployments where vite-plugin-pwa
// does not emit registerSW.js (e.g. Vite 8 + Rolldown compatibility issues).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // noop: app should still work without offline capabilities
    })
  })
}
