import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './assets/main.css'
import SettingsPage from '@renderer/pages/SettingsPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsPage />
  </StrictMode>
)
