import { useState } from 'react'
import AuthPage from '@renderer/pages/AuthPage'
import PermissionsPage from '@renderer/pages/PermissionsPage'

type OnboardingStep = 'auth' | 'permissions'

function App(): React.JSX.Element {
  const [step, setStep] = useState<OnboardingStep>('auth')

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {step === 'auth' && <AuthPage onComplete={() => setStep('permissions')} />}
      {step === 'permissions' && <PermissionsPage onComplete={() => console.log('onboarding done')} />}
    </div>
  )
}

export default App
