import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// Hittar <div id="root"> i index.html och låter React ta över den rutan.
// StrictMode är en utvecklingshjälp som varnar för vanliga misstag.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
