import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import './i18n/i18n' // Initialize i18n
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

if (import.meta.env.PROD) {
  registerServiceWorker()
}
