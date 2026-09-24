import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import type { AppSettings } from '@renderer/../../src/preload/index.d'
import LangDropdown, { toDropdownLanguage, type Language } from '@renderer/components/LangDropdown'
import { api, ApiError } from '@renderer/lib/api'
import type { UserResponse, ConversationHistory, ConversationDay, ConversationMessage } from '@renderer/lib/api'

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

type Tab = 'settings' | 'history'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('settings')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [user, setUser] = useState<UserResponse | null>(null)
  const [languages, setLanguages] = useState<Language[]>([])
  const [langOpen, setLangOpen] = useState(false)
  const [shortcutMode, setShortcutMode] = useState(false)
  const [shortcutCombo, setShortcutCombo] = useState('')
  const [shortcutStatus, setShortcutStatus] = useState<
    'idle' | 'listening' | 'testing' | 'available' | 'taken'
  >('idle')
  const testingRef = useRef(false)

  // Fetch available languages on mount — no auth required
  useEffect(() => {
    api.getLanguages().then((list) => {
      setLanguages(list.map(toDropdownLanguage))
    }).catch(() => {/* leave empty on error */})
  }, [])

  // Load local settings + active shortcut + server user/settings on mount
  useEffect(() => {
    Promise.all([
      window.api.getSettings(),
      window.api.getActiveShortcut(),
      api.getMe().catch(() => null),
      api.getServerSettings().catch(() => null),
    ]).then(([localSettings, shortcut, serverUser, serverSettings]) => {
      // Merge server settings into local (server is source of truth for synced fields)
      const merged: AppSettings = {
        ...localSettings,
        // language lives on the User model, not UserSettings
        ...(serverUser ? { language: serverUser.language } : {}),
        ...(serverSettings
          ? {
              overlayOpacity: serverSettings.overlay_opacity,
              overlaySize: serverSettings.overlay_size,
              micSensitivity: serverSettings.mic_sensitivity,
              soundEffects: serverSettings.sound_effects,
              notifications: serverSettings.notifications,
              wakeWordEnabled: serverSettings.wake_word_enabled,
              launchAtLogin: serverSettings.launch_at_login,
              showInTaskbar: serverSettings.show_in_taskbar,
              voiceGender: serverSettings.voice_gender,
            }
          : {}),
      }
      setSettings(merged)
      if (shortcut) setShortcutCombo(displayShortcut(shortcut))
      if (serverUser) setUser(serverUser)
    })
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
      // Persist locally
      window.api.saveSettings(next)
      // Map camelCase key to snake_case server field and sync (fire and forget)
      // language lives on User model (PATCH /users/me), everything else on UserSettings
      if (key === 'language') {
        api.patchMe({ language: value as string }).catch((err) => {
          if (!(err instanceof ApiError)) console.error('[settings] language sync failed:', err)
        })
        return
      }
      const keyToServerField: Partial<Record<keyof AppSettings, string>> = {
        overlayOpacity: 'overlay_opacity',
        overlaySize: 'overlay_size',
        micSensitivity: 'mic_sensitivity',
        soundEffects: 'sound_effects',
        notifications: 'notifications',
        wakeWordEnabled: 'wake_word_enabled',
        launchAtLogin: 'launch_at_login',
        showInTaskbar: 'show_in_taskbar',
        voiceGender: 'voice_gender',
      }
      const serverField = keyToServerField[key]
      if (serverField) {
        api.patchServerSettings({ [serverField]: value }).catch((err) => {
          if (!(err instanceof ApiError)) console.error('[settings] server sync failed:', err)
        })
      }
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
          padding: '24px 24px 0',
          flexShrink: 0,
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

      {/* ── Tab bar ───────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '16px 16px 0',
          flexShrink: 0,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        {(['settings', 'history'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 18px',
              borderRadius: 'var(--radius-full)',
              border: 'none',
              background: activeTab === tab ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
              color: activeTab === tab ? '#fff' : 'var(--text-secondary)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
              textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Settings tab ──────────────────────────────────────────────── */}
      {activeTab === 'settings' && (
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
            languages={languages}
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

        {/* ── Voice gender ─────────────────────────────────────────────── */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                AI voice
              </p>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 3 }}>
                Voice used for spoken responses
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['female', 'male'] as const).map((gender) => (
                <button
                  key={gender}
                  onClick={() => update('voiceGender', gender)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-full)',
                    border: settings.voiceGender === gender
                      ? '1px solid var(--accent)'
                      : '1px solid rgba(255,255,255,0.12)',
                    background: settings.voiceGender === gender
                      ? 'rgba(108,99,255,0.18)'
                      : 'rgba(255,255,255,0.04)',
                    color: settings.voiceGender === gender
                      ? 'var(--text-primary)'
                      : 'var(--text-secondary)',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    textTransform: 'capitalize',
                  }}
                >
                  {gender}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* ── Account ─────────────────────────────────────────────────── */}
        <SectionLabel icon="ri-user-3-line">Account</SectionLabel>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Avatar — initials from name */}
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #6c63ff 0%, #8b5cf6 100%)',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 700,
                color: '#fff',
              }}
            >
              {user?.full_name
                ? user.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
                : '?'}
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
                {user?.full_name ?? user?.email ?? '—'}
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                {user?.email ?? 'Loading…'}
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
      )}

      {/* ── History tab ───────────────────────────────────────────────── */}
      {activeTab === 'history' && <HistoryPanel />}
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

// ─── History panel ────────────────────────────────────────────────────────────

function HistoryPanel() {
  const [history, setHistory] = useState<ConversationHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getHistory()
      .then((h) => { setHistory(h); setLoading(false) })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load history')
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <i className="ri-loader-4-line" style={{ fontSize: 24, color: 'var(--text-muted)', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <p style={{ fontSize: 14, color: '#ef4444', textAlign: 'center' }}>{error}</p>
      </div>
    )
  }

  if (!history || history.days.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 }}>
        <i className="ri-chat-history-line" style={{ fontSize: 36, color: 'var(--text-muted)' }} />
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6, maxWidth: 260 }}>
          No conversation history yet. Start using Hover to see your sessions here.
        </p>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 16px 24px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {history.days.map((day) => <DayGroup key={day.date} day={day} />)}
    </div>
  )
}

function DayGroup({ day }: { day: ConversationDay }) {
  const label = formatDayLabel(day.date)
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {day.messages.map((msg) => <MessageRow key={msg.id} message={msg} />)}
        </div>
      </Card>
    </div>
  )
}

function MessageRow({ message }: { message: ConversationMessage }) {
  const isUser = message.role === 'user'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: isUser ? 'var(--text-muted)' : 'var(--accent)',
      }}>
        {isUser ? 'You' : 'Hover'}
      </span>
      <p style={{
        margin: 0,
        fontSize: isUser ? 13 : 14,
        color: isUser ? 'var(--text-secondary)' : 'var(--text-primary)',
        lineHeight: 1.55,
        fontWeight: isUser ? 400 : 500,
      }}>
        {message.content}
      </p>
    </div>
  )
}

function formatDayLabel(dateStr: string): string {
  // dateStr is "2025-01-15" UTC
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const todayUtc = new Date()
  const todayStr = `${todayUtc.getUTCFullYear()}-${String(todayUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(todayUtc.getUTCDate()).padStart(2, '0')}`
  const yesterdayUtc = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate() - 1))
  const yesterdayStr = `${yesterdayUtc.getUTCFullYear()}-${String(yesterdayUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterdayUtc.getUTCDate()).padStart(2, '0')}`
  if (dateStr === todayStr) return 'Today'
  if (dateStr === yesterdayStr) return 'Yesterday'
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}
