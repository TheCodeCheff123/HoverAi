import { useState } from 'react'
import AuthPage from '@renderer/pages/AuthPage'
import PermissionsPage from '@renderer/pages/PermissionsPage'
import ShortcutPage from '@renderer/pages/ShortcutPage'

type OnboardingStep = 'auth' | 'permissions' | 'shortcut'

function App(): React.JSX.Element {
  const [step, setStep] = useState<OnboardingStep>('auth')

  function handleOnboardingComplete() {
    window.api.launchOverlay()
    window.electron.ipcRenderer.send('close-main-window')
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {step === 'auth' && <AuthPage onComplete={() => setStep('permissions')} />}
      {step === 'permissions' && <PermissionsPage onComplete={() => setStep('shortcut')} />}
      {step === 'shortcut' && <ShortcutPage onComplete={handleOnboardingComplete} />}
    </div>
  )
}

export default App
