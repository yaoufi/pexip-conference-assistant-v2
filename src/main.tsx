import React from 'react'
import ReactDOM from 'react-dom/client'
// Import fonts
import '@pexip/components/src/fonts.css'
// Import other global styles
import '@pexip/components/dist/components.css'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary'

import './index.css'

ReactDOM.createRoot(document.getElementById('root') as Element).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
