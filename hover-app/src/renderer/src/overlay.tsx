import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'remixicon/fonts/remixicon.css'
import OverlayWidget from '@renderer/overlay/OverlayWidget'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OverlayWidget />
  </StrictMode>
)
