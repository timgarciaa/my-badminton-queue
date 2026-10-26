import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { PlayerCheckinPage } from './pages/PlayerCheckinPage'

registerSW({ immediate: true })

// Players' phones open the check-in link (?c=CODE) instead of the iPad app.
const code = new URLSearchParams(location.search).get('c')?.toUpperCase()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {code ? <PlayerCheckinPage code={code} /> : <App />}
  </StrictMode>,
)
