import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { publicPath } from './lib/publicStats'
import { PlayerCheckinPage } from './pages/PlayerCheckinPage'
import { PublicStatsPage } from './pages/PublicStatsPage'

registerSW({ immediate: true })

// Players' phones open the check-in link (?c=CODE) instead of the iPad app,
// and a club's public stats page is …/my-badminton-queue/<link name>[/<player>].
const code = new URLSearchParams(location.search).get('c')?.toUpperCase()
const open = publicPath(location.pathname, import.meta.env.BASE_URL)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {code ? <PlayerCheckinPage code={code} /> : open ? <PublicStatsPage {...open} /> : <App />}
  </StrictMode>,
)
