import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './data/queryClient'
import { router } from './router'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import { applySystemThemeOnce } from './hooks/useSystemTheme'
import './i18n/i18n' // Initialize i18n
import './index.css'

// After a deploy, open tabs may request old hashed chunks that no longer exist.
// Reload once to pick up the new build; a cooldown prevents reload loops.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'preload-error-reload-at'
  const last = Number(window.sessionStorage.getItem(key) ?? 0)
  if (Date.now() - last > 10_000) {
    window.sessionStorage.setItem(key, String(Date.now()))
    event.preventDefault()
    window.location.reload()
  }
})

// Public routes don't load user settings, so sync theme with OS preference immediately
// to avoid a white flash before React mounts.
const publicPaths = new Set(['/', '/login', '/register'])
const initialPath = window.location.pathname.replace(/\/+$/, '') || '/'
if (publicPaths.has(initialPath)) {
  applySystemThemeOnce()
}
try {
  window.localStorage.removeItem('thread-store')
} catch {
  // ignore storage cleanup errors
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)

if (import.meta.env.PROD) {
  registerServiceWorker()
}
