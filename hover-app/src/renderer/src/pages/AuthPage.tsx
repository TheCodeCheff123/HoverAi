import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import AuthPanel from '@renderer/components/AuthPanel'

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
  exit: (dir: number) => ({ opacity: 0, x: dir * -24, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const } }),
}

export default function AuthPage({ onComplete }: AuthPageProps) {
  const [tab, setTab] = useState<Tab>('signin')
  const [prevTab, setPrevTab] = useState<Tab>('signin')
  const [showPassword, setShowPassword] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [lang, setLang] = useState<{ value: string; label: string }>(LANGUAGES[0])

  const dir = tab === 'signup' && prevTab === 'signin' ? 1 : -1

  function switchTab(t: Tab) {
    setPrevTab(tab)
    setTab(t)
    setShowPassword(false)
    setLangOpen(false)
  }

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', background: 'var(--bg)' }}>
      <AuthPanel />

      {/* Right panel */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '18px 52px',
          position: 'relative',
          overflowY: 'auto',
          overflowX: 'hidden',
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
            {/* Tab switcher pill — glass container */}
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
                    /* Active tab: slightly lighter glass fill */
                    background: tab === t
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
        <div style={{ position: 'relative', overflow: 'hidden' }}>
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
                  <h1 style={{
                    fontSize: 34,
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    color: 'var(--text-primary)',
                  }}>
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
                  onSubmit={(e) => { e.preventDefault(); onComplete() }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
                >
                  {/* Full name — signup only */}
                  <AnimatePresence>
                    {tab === 'signup' && (
                      <motion.div
                        key="fullname"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto', transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const } }}
                        exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div style={{ paddingBottom: 2 }}>
                          <Field label="Full Name">
                            <Input type="text" placeholder="Amara Okafor" />
                          </Field>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Email */}
                  <motion.div variants={itemVariants}>
                    <Field label="Email">
                      <Input type="email" placeholder="you@studio.com" />
                    </Field>
                  </motion.div>

                  {/* Password */}
                  <motion.div variants={itemVariants}>
                    <Field label="Password">
                      <PasswordInput show={showPassword} onToggle={() => setShowPassword(v => !v)} />
                    </Field>
                  </motion.div>

                  {/* Language preference */}
                  <motion.div variants={itemVariants}>
                    <Field label="Language preference">
                      <LangDropdown
                        value={lang}
                        open={langOpen}
                        onToggle={() => setLangOpen(v => !v)}
                        onSelect={(l) => { setLang(l); setLangOpen(false) }}
                      />
                    </Field>
                  </motion.div>

                  {/* CTA */}
                  <motion.div variants={itemVariants}>
                    <motion.button
                      type="submit"
                      whileHover={{ scale: 1.015 }}
                      whileTap={{ scale: 0.98 }}
                      style={{
                        width: '100%',
                        padding: '15px 0',
                        borderRadius: 999,
                        border: 'none',
                        cursor: 'pointer',
                        background: 'var(--accent)',
                        color: '#fff',
                        fontSize: 17,
                        fontWeight: 700,
                        letterSpacing: '-0.01em',
                      }}
                    >
                      Get Started Free
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

function Input({ type, placeholder }: { type: string; placeholder: string }) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      type={type}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...baseInput,
        /* On focus: switch to solid brand border (overrides the glass border-box layer) */
        border: focused ? '1px solid var(--border-focus)' : '1px solid transparent',
        boxShadow: focused ? '0 0 0 3px rgba(108,99,255,0.15)' : 'none',
      }}
    />
  )
}

function PasswordInput({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        placeholder="••••••••"
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

const LANGUAGES = [
  { value: 'en-pidgin', label: 'English + pidgin' },
  { value: 'en',        label: 'English' },
  { value: 'fr',        label: 'French' },
  { value: 'yo',        label: 'Yoruba' },
  { value: 'ha',        label: 'Hausa' },
  { value: 'ig',        label: 'Igbo' },
]

function LangDropdown({
  value,
  open,
  onToggle,
  onSelect,
}: {
  value: { value: string; label: string }
  open: boolean
  onToggle: () => void
  onSelect: (l: { value: string; label: string }) => void
}) {
  return (
    <div style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        type="button"
        onClick={onToggle}
        style={{
          ...baseInput,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          border: open ? '1px solid var(--border-focus)' : '1px solid transparent',
          boxShadow: open ? '0 0 0 3px rgba(108,99,255,0.15)' : 'none',
          color: 'var(--text-secondary)',
          width: '100%',
        }}
      >
        <span style={{ color: 'var(--text-primary)' }}>{value.label}</span>
        <motion.i
          className="ri-arrow-down-s-line"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] as const }}
          style={{ fontSize: 20, color: 'var(--text-secondary)', display: 'block' }}
        />
      </button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="lang-dropdown-panel"
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const } }}
            exit={{ opacity: 0, y: 4, scale: 0.97, transition: { duration: 0.15 } }}
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              /* Full glass — this panel floats over the form, backdrop-filter frosts it */
              background: [
                'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%) padding-box',
                'linear-gradient(135deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0.07) 35%, rgba(255,255,255,0.01) 100%) border-box',
                'rgba(16,14,36,0.82) padding-box',
              ].join(', '),
              border: '1px solid transparent',
              backdropFilter: 'blur(20px) saturate(160%) brightness(1.06)',
              WebkitBackdropFilter: 'blur(20px) saturate(160%) brightness(1.06)',
              borderRadius: 14,
              maxHeight: 232,
              overflowY: 'auto',
              overflowX: 'hidden',
              zIndex: 50,
              boxShadow: [
                '0 -8px 32px rgba(0,0,0,0.55)',
                '0 -2px 8px rgba(0,0,0,0.35)',
                '0 0 0 0.5px rgba(255,255,255,0.08)',
              ].join(', '),
              scrollbarWidth: 'none',
            }}
          >
            {LANGUAGES.map((l, i) => (
              <button
                key={l.value}
                type="button"
                onClick={() => onSelect(l)}
                style={{
                  width: '100%',
                  padding: '11px 18px',
                  background: l.value === value.value ? 'rgba(108,99,255,0.15)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: l.value === value.value ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 15,
                  fontWeight: l.value === value.value ? 600 : 400,
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: i < LANGUAGES.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (l.value !== value.value) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                }}
                onMouseLeave={(e) => {
                  if (l.value !== value.value) e.currentTarget.style.background = 'transparent'
                }}
              >
                {l.label}
                {l.value === value.value && (
                  <i className="ri-check-line" style={{ fontSize: 16, color: 'var(--accent)' }} />
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const baseInput: React.CSSProperties = {
  width: '100%',
  padding: '13px 18px',
  borderRadius: 999,
  /* Glass fill — faint tint + directional edge highlight.
   * Focus state (border-focus + ring glow) is applied inline and overrides
   * the border-box layer when focused — keep that behaviour. */
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
