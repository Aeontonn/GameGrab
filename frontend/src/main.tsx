import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Finds <div id="root"> in index.html and lets React take over that element.
// StrictMode is a development aid that warns about common mistakes.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
