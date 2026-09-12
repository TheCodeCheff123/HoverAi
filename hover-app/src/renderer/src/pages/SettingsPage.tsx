import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import type { AppSettings } from '@renderer/../../src/preload/index.d'
import LangDropdown from '@renderer/components/LangDropdown'

// ─── Constants ────────────────────────────────────────────────────────────────

const MODIFIER_KEYS = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'Super',
  'Hyper',
  'Unidentified',
  'Dead',
  'Process',
])

function formatCombo(e: KeyboardEvent): string {
  if (MODIFIER_KEYS.has(e.key)) return ''
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return ''
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  if (!key || key === 'Unidentified') return ''
  parts.push(key)
  return parts.join('+')
}

function toAccelerator(combo: string): string {
  return combo.replace('Ctrl', 'CommandOrControl').replace('Meta', 'CommandOrControl')
}

function displayShortcut(acc: string): string {
  return acc.replace('CommandOrControl', 'Ctrl')
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [langOpen, setLangOpen] = useState(false)
  const [shortcutMode, setShortcutMode] = useState(false)
  const [shortcutCombo, setShortcutCombo] = useState('')
  const [shortcutStatus, setShortcutStatus] = useState<
    'idle' | 'listening' | 'testing' | 'available' | 'taken'
  >('idle')
  const testingRef = useRef(false)

  // Load settings + active shortcut on mount
  useEffect(() => {
    Promise.all([window.api.getSettings(), window.api.getActiveShortcut()]).then(
      ([s, shortcut]) => {
        setSettings(s)
        if (shortcut) setShortcutCombo(displayShortcut(shortcut))
      }
    )
  }, [])

  // Keyboard listener for shortcut recording
  useEffect(() => {
    if (!shortcutMode) return
    const onKeyDown = async (e: KeyboardEvent) => {
      e.preventDefault()
      const combo = formatCombo(e)
      if (!combo) return
      setShortcutCombo(combo)
      setShortcutMode(false)
      if (testingRef.current) return
      testingRef.current = true
      setShortcutStatus('testing')
      const acc = toAccelerator(combo)
      const available = await window.api.testShortcut(acc).catch(() => false)
      setShortcutStatus(available ? 'available' : 'taken')
      testingRef.current = false
      if (available) {
        await window.api.registerShortcutFromSettings(acc).catch(() => false)
        setShortcutStatus('idle')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcutMode])

  const update = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      if (!settings) return
      const next = { ...settings, [key]: value }
      setSettings(next)
      window.api.saveSettings(next)
    },
    [settings]
  )

  if (!settings) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#1c1c1e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <i className="ri-loader-4-line" style={{ fontSize: 24, color: 'var(--text-muted)', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }


  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#1c1c1e',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ── Title bar (drag region + close) ───────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '24px 24px 20px',
          flexShrink: 0,
          // Makes the whole header draggable on macOS / Windows
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
          }}
        >
          Settings
        </h1>
        <button
          onClick={() => window.api.closeSettingsWindow()}
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(255,255,255,0.08)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          ✕
        </button>
      </div>

      {/* ── Scrollable body ────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '0 16px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* ── Language preference ─────────────────────────────────────── */}
        <SectionLabel>Language preference</SectionLabel>
        <div>
          <LangDropdown
            value={settings.language}
            open={langOpen}
            onToggle={() => setLangOpen((v) => !v)}
            onSelect={(l) => {
              update('language', l.value)
              setLangOpen(false)
            }}
            variant="solid"
          />
        </div>

        {/* ── Capture shortcut ────────────────────────────────────────── */}
        <Card>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            {/* Key chips */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {shortcutMode ? (
                <span style={{ fontSize: 14, color: 'var(--accent)', fontWeight: 600 }}>
                  Press a key combo…
                </span>
              ) : shortcutCombo ? (
                shortcutCombo.split('+').map((part, i, arr) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <KeyChip>{part}</KeyChip>
                    {i < arr.length - 1 && (
                      <span style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500 }}>
                        +
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>No shortcut set</span>
              )}
              {shortcutStatus === 'testing' && (
                <i
                  className="ri-loader-4-line"
                  style={{
                    fontSize: 14,
                    color: 'var(--text-muted)',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
              )}
              {shortcutStatus === 'taken' && (
                <span style={{ fontSize: 12, color: '#ef4444' }}>Already taken</span>
              )}
            </div>

            {/* Change button */}
            <button
              onClick={() => {
                setShortcutMode(true)
                setShortcutStatus('listening')
              }}
              style={{
                padding: '10px 22px',
                borderRadius: 'var(--radius-full)',
                border: '1px solid rgba(255,255,255,0.12)',
                background: shortcutMode ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                color: shortcutMode ? '#fff' : 'var(--text-primary)',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'background 0.15s, border-color 0.15s',
              }}
            >
              {shortcutMode ? 'Listening…' : 'Change'}
            </button>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </Card>

        {/* ── Voice sensitivity ────────────────────────────────────────── */}
        <Card>
          <p
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: 14,
            }}
          >
            Voice sensitivity
          </p>
          <Slider
            value={settings.micSensitivity}
            min={1}
            max={10}
            onChange={(v) => update('micSensitivity', v)}
          />
        </Card>

        {/* ── Always-on wake word ─────────────────────────────────────── */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                Always-on wake word
              </p>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 3 }}>
                Say &ldquo;Hover&rdquo; instead of the shortcut
              </p>
            </div>
            <Toggle
              checked={settings.wakeWordEnabled}
              onChange={(v) => update('wakeWordEnabled', v)}
            />
          </div>
        </Card>

        {/* ── Account ─────────────────────────────────────────────────── */}
        <SectionLabel icon="ri-user-3-line">Account</SectionLabel>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Avatar */}
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #f59e0b 0%, #8b5cf6 100%)',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
            >
              🧑‍🎨
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                amara@studio.com
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                Free plan
              </p>
            </div>

            {/* Sign out */}
            <button
              onClick={() => window.api.signOut()}
              style={{
                padding: '9px 18px',
                borderRadius: 'var(--radius-full)',
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.05)',
                color: 'var(--text-primary)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
              }}
            >
              Sign Out
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#2c2c2e',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 18px',
      }}
    >
      {children}
    </div>
  )
}

function SectionLabel({
  children,
  icon,
}: {
  children: React.ReactNode
  icon?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '10px 4px 4px',
        fontSize: 14,
        fontWeight: 500,
        color: 'var(--text-secondary)',
        letterSpacing: '0.01em',
      }}
    >
      {icon && <i className={icon} style={{ fontSize: 16 }} />}
      {children}
    </div>
  )
}

function KeyChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        padding: '6px 14px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.12)',
        fontSize: 16,
        fontWeight: 700,
        color: 'var(--text-primary)',
        display: 'inline-block',
      }}
    >
      {children}
    </span>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 52,
        height: 30,
        borderRadius: 'var(--radius-full)',
        border: 'none',
        cursor: 'pointer',
        padding: 3,
        background: checked ? 'var(--accent)' : '#3a3a3c',
        transition: 'background 0.25s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: checked ? 'flex-end' : 'flex-start',
        flexShrink: 0,
      }}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: '#fff',
          display: 'block',
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
          flexShrink: 0,
        }}
      />
    </button>
  )
}

function Slider({
  value,
  min,
  max,
  onChange,
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div style={{ position: 'relative', height: 24, display: 'flex', alignItems: 'center' }}>
      {/* Track */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: 4,
          borderRadius: 2,
          background: 'rgba(255,255,255,0.12)',
        }}
      />
      {/* Fill */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          width: `${pct}%`,
          height: 4,
          borderRadius: 2,
          background: 'rgba(255,255,255,0.35)',
          pointerEvents: 'none',
        }}
      />
      {/* Native input (invisible, on top) */}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          width: '100%',
          opacity: 0,
          cursor: 'pointer',
          height: 24,
          margin: 0,
        }}
      />
      {/* Thumb */}
      <div
        style={{
          position: 'absolute',
          left: `calc(${pct}% - 11px)`,
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: '#aeaeb2',
          boxShadow: '0 1px 6px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
          transition: 'left 0.05s',
        }}
      />
    </div>
  )
}
