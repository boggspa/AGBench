import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PopoutApp } from './PopoutApp'

const params = new URLSearchParams(window.location.search)
const popoutKind = params.get('popout')
const isUtilityPopout = Boolean(popoutKind && popoutKind !== 'chat')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>{isUtilityPopout ? <PopoutApp /> : <App />}</ErrorBoundary>
  </StrictMode>
)
