import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import AuthPanel from '@renderer/components/AuthPanel'
import LangDropdown, { toDropdownLanguage, type Language } from '@renderer/components/LangDropdown'
import { api, ApiError } from '@renderer/lib/api'

type Tab = 'signin' | 'signup'

interface AuthPageProps {
  onComplete: () => void
}

// Stagger children fade-up
const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const } },
}

// Slide transition when switching tabs
const formVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 24 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const } },
  exit: (dir: number) => ({
    opacity: 0,
    x: dir * -24,
    transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const },
  }),
}

export default function AuthPage({ onComplete }: AuthPageProps) {
  const [tab, setTab] = useState<Tab>('signin')
  const [prevTab, setPrevTab] = useState<Tab>('signin')
  const [showPassword, setShowPassword] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [languages, setLanguages] = useState<Language[]>([])
  const [lang, setLang] = useState<Language | null>(null)

  // Fetch available languages on mount — no auth required
  useEffect(() => {
    api.getLanguages().then((list) => {
      const mapped = list.map(toDropdownLanguage)
      setLanguages(mapped)
      // Use the entry flagged as default; fall back to first
      const defaultEntry = list.find((l) => l.default)
      setLang(defaultEntry ? { value: defaultEntry.code, label: defaultEntry.label } : mapped[0] ?? null)
    }).catch(() => {
      // If the fetch fails, leave lists empty — the dropdown will render nothing
    })
  }, [])

  // Form fields
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Submission state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dir = tab === 'signup' && prevTab === 'signin' ? 1 : -1

  function switchTab(t: Tab) {
    setPrevTab(tab)
    setTab(t)
    setShowPassword(false)
    setLangOpen(false)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      let tokens
      if (tab === 'signup') {
        tokens = await api.signup({
          email: email.trim(),
          full_name: fullName.trim(),
          password,
          language: lang?.value,
          device_id: 'electron',
        })
      } else {
        tokens = await api.signin({
          email: email.trim(),
          password,
          device_id: 'electron',
        })
      }

      await window.api.storeTokens(tokens.access_token, tokens.refresh_token)
      onComplete()
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.detail)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', background: 'var(--bg)', overflow: 'hidden' }}>
      <AuthPanel />

      {/* Right panel — scrollable */}
      <div
        style={{
          flex: 1,
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {/* Inner wrapper centres content vertically when there's room, but scrolls when not */}
        <div
          style={{
            minHeight: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '32px 52px',
            position: 'relative',
          }}
        >
        {/* Header — animates in once on mount */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          style={{ marginBottom: 2 }}
        >
          {/* Tab switcher */}
          <motion.div variants={itemVariants}>
            <div
              style={{
                display: 'flex',
                borderRadius: 999,
                padding: 6,
                gap: 4,
                background: [
                  'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.01) 100%) padding-box',
                  'linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 40%, rgba(255,255,255,0.01) 100%) border-box',
                  'rgba(14,12,32,0.60) padding-box',
                ].join(', '),
                border: '1px solid transparent',
                boxShadow: '0 4px 20px rgba(0,0,0,0.40), 0 1px 4px rgba(0,0,0,0.30)',
              }}
            >
              {(['signin', 'signup'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => switchTab(t)}
                  style={{
                    flex: 1,
                    padding: '13px 0',
                    borderRadius: 999,
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 15,
                    transition: 'background 0.18s, color 0.18s, box-shadow 0.18s',
                    background:
                      tab === t
                        ? [
                            'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 100%) padding-box',
                            'linear-gradient(135deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.02) 100%) border-box',
                            'rgba(40,36,72,0.70) padding-box',
                          ].join(', ')
                        : 'transparent',
                    boxShadow: tab === t ? '0 2px 8px rgba(0,0,0,0.35)' : 'none',
                    color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
                  } as React.CSSProperties}
                >
                  {t === 'signin' ? 'Sign In' : 'Create account'}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>

        {/* Animated form — slides when tab changes */}
        {/* overflow: visible so the language dropdown panel is not clipped */}
        <div style={{ position: 'relative', overflow: 'visible' }}>
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={tab}
              custom={dir}
              variants={formVariants}
              initial="enter"
              animate="center"
              exit="exit"
            >
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                style={{ display: 'flex', flexDirection: 'column', gap: 0 }}
              >
                {/* Heading */}
                <motion.div variants={itemVariants} style={{ marginBottom: 2 }}>
                  <h1
                    style={{
                      fontSize: 34,
                      fontWeight: 700,
                      letterSpacing: '-0.02em',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {tab === 'signin' ? 'Welcome back' : 'Create your account'}
                  </h1>
                </motion.div>

                <motion.div variants={itemVariants} style={{ marginBottom: 20 }}>
                  <p style={{ color: 'var(--text-secondary)', fontSize: 16 }}>
                    {tab === 'signin'
                      ? 'Sign in to keep building with your voice.'
                      : 'Set up Hover AI in under a minute.'}
                  </p>
                </motion.div>

                <form
                  onSubmit={handleSubmit}
                  style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
                >
                  {/* Full name — signup only */}
                  <AnimatePresence>
                    {tab === 'signup' && (
                      <motion.div
                        key="fullname"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{
                          opacity: 1,
                          height: 'auto',
                          transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const },
                        }}
                        exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div style={{ paddingBottom: 2 }}>
                          <Field label="Full Name">
                            <Input
                              type="text"
                              placeholder="Amara Okafor"
                              value={fullName}
                              onChange={setFullName}
                              required={tab === 'signup'}
                            />
                          </Field>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Email */}
                  <motion.div variants={itemVariants}>
                    <Field label="Email">
                      <Input
                        type="email"
                        placeholder="you@studio.com"
                        value={email}
                        onChange={setEmail}
                        required
                      />
                    </Field>
                  </motion.div>

                  {/* Password */}
                  <motion.div variants={itemVariants}>
                    <Field label="Password">
                      <PasswordInput
                        show={showPassword}
                        onToggle={() => setShowPassword((v) => !v)}
                        value={password}
                        onChange={setPassword}
                      />
                    </Field>
                  </motion.div>

                  {/* Language preference — signup only */}
                  <AnimatePresence>
                    {tab === 'signup' && (
                      <motion.div
                        key="lang"
                        variants={itemVariants}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{
                          opacity: 1,
                          height: 'auto',
                          transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const },
                        }}
                        exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
                        style={{ overflow: 'visible' }}
                      >
                        <Field label="Language preference">
                          <LangDropdown
                            value={lang?.value ?? ''}
                            open={langOpen}
                            onToggle={() => setLangOpen((v) => !v)}
                            onSelect={(l) => {
                              setLang(l)
                              setLangOpen(false)
                            }}
                            languages={languages}
                            variant="glass"
                          />
                        </Field>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Inline error banner */}
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        key="error"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div
                          style={{
                            padding: '11px 16px',
                            borderRadius: 12,
                            background: 'rgba(239,68,68,0.12)',
                            border: '1px solid rgba(239,68,68,0.35)',
                            color: '#fca5a5',
                            fontSize: 14,
                            lineHeight: 1.5,
                          }}
                        >
                          {error}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* CTA */}
                  <motion.div variants={itemVariants}>
                    <motion.button
                      type="submit"
                      disabled={loading}
                      whileHover={loading ? {} : { scale: 1.015 }}
                      whileTap={loading ? {} : { scale: 0.98 }}
                      style={{
                        width: '100%',
                        padding: '15px 0',
                        borderRadius: 999,
                        border: 'none',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        background: loading ? 'rgba(108,99,255,0.5)' : 'var(--accent)',
                        color: '#fff',
                        fontSize: 17,
                        fontWeight: 700,
                        letterSpacing: '-0.01em',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                      }}
                    >
                      {loading && (
                        <i
                          className="ri-loader-4-line"
                          style={{ fontSize: 18, animation: 'spin 0.8s linear infinite' }}
                        />
                      )}
                      {loading
                        ? tab === 'signin'
                          ? 'Signing in…'
                          : 'Creating account…'
                        : 'Get Started Free'}
                      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                    </motion.button>
                  </motion.div>

                  {/* Legal */}
                  <motion.p
                    variants={itemVariants}
                    style={{
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.6,
                      textAlign: 'center',
                      marginBottom: 4,
                    }}
                  >
                    By continuing, you agree to Hover AI&apos;s{' '}
                    <span
                      className="terms-link"
                      onClick={() => window.api.openExternal('https://google.com')}
                    >
                      Terms and Privacy Policy
                    </span>
                    .
                  </motion.p>
                </form>
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </div>
        </div>{/* end inner centering wrapper */}
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <label style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</label>
      {children}
    </div>
  )
}

function Input({
  type,
  placeholder,
  value,
  onChange,
  required,
}: {
  type: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  required?: boolean
}) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...baseInput,
        border: focused ? '1px solid var(--border-focus)' : '1px solid transparent',
        boxShadow: focused ? '0 0 0 3px rgba(108,99,255,0.15)' : 'none',
      }}
    />
  )
}

function PasswordInput({
  show,
  onToggle,
  value,
  onChange,
}: {
  show: boolean
  onToggle: () => void
  value: string
  onChange: (v: string) => void
}) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        placeholder="••••••••"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...baseInput,
          paddingRight: 48,
          border: focused ? '1px solid var(--border-focus)' : '1px solid transparent',
          boxShadow: focused ? '0 0 0 3px rgba(108,99,255,0.15)' : 'none',
        }}
      />
      <button
        type="button"
        onClick={onToggle}
        style={{
          position: 'absolute',
          right: 16,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <i className={show ? 'ri-eye-off-line' : 'ri-eye-line'} style={{ fontSize: 18 }} />
      </button>
    </div>
  )
}

const baseInput: React.CSSProperties = {
  width: '100%',
  padding: '13px 18px',
  borderRadius: 999,
  background: [
    'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%) padding-box',
    'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.05) 40%, rgba(255,255,255,0.01) 100%) border-box',
    'rgba(255,255,255,0.03) padding-box',
  ].join(', '),
  border: '1px solid transparent',
  color: 'var(--text-primary)',
  fontSize: 16,
  outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s, background 0.15s',
}
