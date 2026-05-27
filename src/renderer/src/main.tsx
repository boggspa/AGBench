import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PopoutApp } from './PopoutApp'

const isPopout = new URLSearchParams(window.location.search).has('popout')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isPopout ? <PopoutApp /> : <App />}
    </ErrorBoundary>
  </StrictMode>
)
