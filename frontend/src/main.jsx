import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/erp-theme.css'
import './styles/erp-ui-spacing.css'
import { logPerformanceEvent } from './utils/performanceLogger'
import App from './App.jsx'

function isExtensionSource(source) {
  if (typeof source !== 'string') return false
  return source.includes('chrome-extension://') || source.includes('moz-extension://') || source.includes('safari-extension://')
}

function logFrontendError(message, metadata = {}) {
  logPerformanceEvent({
    module: 'frontend',
    action: 'runtime_error',
    event_type: 'frontend_error',
    status: 'error',
    severity: 'error',
    error_message: message,
    message,
    metadata: {
      route: typeof window !== 'undefined' ? window.location?.pathname : undefined,
      source: metadata.source || 'frontend'
    }
  })
}

window.addEventListener('error', (event) => {
  try {
    if (isExtensionSource(event.filename)) return
    logFrontendError(event.message || 'Uncaught error', { source: 'window.onerror' })
  } catch {
    // Never break boot.
  }
})

window.addEventListener('unhandledrejection', (event) => {
  try {
    const reason = event.reason
    const message = reason?.message || String(reason || 'Unhandled rejection')
    logFrontendError(message, { source: 'unhandledrejection' })
  } catch {
    // Never break boot.
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
