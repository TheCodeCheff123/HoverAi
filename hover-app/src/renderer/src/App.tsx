import { useState } from 'react'
import AuthPage from '@renderer/pages/AuthPage'
import PermissionsPage from '@renderer/pages/PermissionsPage'

type OnboardingStep = 'auth' | 'permissions'

function App(): React.JSX.Element {
  const [step, setStep] = useState<OnboardingStep>('auth')

  function handleOnboardingComplete() {
    // Tell the main process to open the overlay window, then close this one
    window.api.launchOverlay()
    window.electron.ipcRenderer.send('close-main-window')
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {step === 'auth' && <AuthPage onComplete={() => setStep('permissions')} />}
      {step === 'permissions' && <PermissionsPage onComplete={handleOnboardingComplete} />}
    </div>
  )
}

export default App
