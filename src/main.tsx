import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { registerServiceWorker } from './app/registerSW'
import { bootTelegram } from './telegram'

registerServiceWorker()

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')
// Inside Telegram the launch parameters arrive in the URL hash, and the hash
// router replaces it on first render — so Telegram's script has to read them
// before anything mounts. In a plain browser this resolves at once.
void bootTelegram().finally(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
