import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import { applySystemThemeOnce } from './hooks/useSystemTheme'
import './i18n/i18n' // Initialize i18n
import './index.css'

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
    <RouterProvider router={router} />
  </StrictMode>,
)

if (import.meta.env.PROD) {
  registerServiceWorker()
}
