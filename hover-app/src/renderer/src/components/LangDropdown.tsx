import { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ─── Shared language list — edit here to change options everywhere ────────────

export type Language = { value: string; label: string }

export const LANGUAGES: Language[] = [
  { value: 'en-pidgin', label: 'English + pidgin' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'yo', label: 'Yoruba' },
  { value: 'ha', label: 'Hausa' },
  { value: 'ig', label: 'Igbo' },
]

const EASE = [0.22, 1, 0.36, 1] as const

// ─── Props ────────────────────────────────────────────────────────────────────

interface LangDropdownProps {
  /** Currently selected language value string */
  value: string
  /** Whether the dropdown is open */
  open: boolean
  /** Toggle open/closed */
  onToggle: () => void
  /** Called when user picks a language */
  onSelect: (lang: Language) => void
  /**
   * 'glass'  — auth page style: pill trigger, frosted-glass panel opening upward
   * 'solid'  — settings page style: rounded trigger, solid dark panel opening downward
   */
  variant?: 'glass' | 'solid'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LangDropdown({
  value,
  open,
  onToggle,
  onSelect,
  variant = 'glass',
}: LangDropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = LANGUAGES.find((l) => l.value === value) ?? LANGUAGES[0]

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onToggle()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onToggle])

  const isGlass = variant === 'glass'

  // ── Trigger styles ──────────────────────────────────────────────────────────
  const triggerStyle: React.CSSProperties = isGlass
    ? {
        // Glass pill — matches AuthPage baseInput style
        width: '100%',
        padding: '13px 18px',
        borderRadius: 999,
        background: [
          'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%) padding-box',
          'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.05) 40%, rgba(255,255,255,0.01) 100%) border-box',
          'rgba(255,255,255,0.03) padding-box',
        ].join(', '),
        border: open ? '1px solid var(--border-focus)' : '1px solid transparent',
        boxShadow: open ? '0 0 0 3px rgba(108,99,255,0.15)' : 'none',
        color: 'var(--text-secondary)',
        fontSize: 16,
        outline: 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
      }
    : {
        // Solid pill — matches SettingsPage style
        width: '100%',
        padding: '14px 18px',
        borderRadius: 'var(--radius-full)',
        border: open ? '1px solid var(--border-focus)' : '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.04)',
        color: 'var(--text-primary)',
        fontSize: 16,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: open ? '0 0 0 3px rgba(108,99,255,0.15)' : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        outline: 'none',
      }

  // ── Panel animation: upward for glass, downward for solid ──────────────────
  const panelPosition: React.CSSProperties = isGlass
    ? { bottom: 'calc(100% + 6px)', top: 'auto' }
    : { top: 'calc(100% + 6px)', bottom: 'auto' }

  const panelInitial = isGlass ? { opacity: 0, y: 6, scale: 0.97 } : { opacity: 0, y: -6, scale: 0.97 }
  const panelExit = isGlass ? { opacity: 0, y: 4, scale: 0.97 } : { opacity: 0, y: -4, scale: 0.97 }

  const panelBackground: React.CSSProperties = isGlass
    ? {
        background: [
          'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%) padding-box',
          'linear-gradient(135deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0.07) 35%, rgba(255,255,255,0.01) 100%) border-box',
          'rgba(16,14,36,0.82) padding-box',
        ].join(', '),
        border: '1px solid transparent',
        backdropFilter: 'blur(20px) saturate(160%) brightness(1.06)',
        WebkitBackdropFilter: 'blur(20px) saturate(160%) brightness(1.06)',
        boxShadow: [
          '0 -8px 32px rgba(0,0,0,0.55)',
          '0 -2px 8px rgba(0,0,0,0.35)',
          '0 0 0 0.5px rgba(255,255,255,0.08)',
        ].join(', '),
      }
    : {
        background: '#2c2c2e',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
      }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button type="button" onClick={onToggle} style={triggerStyle}>
        <span style={{ color: 'var(--text-primary)' }}>{selected.label}</span>
        <motion.i
          className="ri-arrow-down-s-line"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: EASE }}
          style={{ fontSize: 20, color: 'var(--text-secondary)', display: 'block' }}
        />
      </button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="lang-dropdown-panel"
            initial={panelInitial}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.2, ease: EASE } }}
            exit={{ ...panelExit, transition: { duration: 0.15 } }}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              borderRadius: 14,
              maxHeight: 232,
              overflowY: 'auto',
              overflowX: 'hidden',
              zIndex: 50,
              scrollbarWidth: 'none',
              ...panelPosition,
              ...panelBackground,
            }}
          >
            {LANGUAGES.map((l, i) => (
              <button
                key={l.value}
                type="button"
                onClick={() => onSelect(l)}
                style={{
                  width: '100%',
                  padding: isGlass ? '11px 18px' : '12px 18px',
                  background: l.value === value ? 'rgba(108,99,255,0.15)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: l.value === value ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 15,
                  fontWeight: l.value === value ? 600 : 400,
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom:
                    i < LANGUAGES.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (l.value !== value)
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                }}
                onMouseLeave={(e) => {
                  if (l.value !== value) e.currentTarget.style.background = 'transparent'
                }}
              >
                {l.label}
                {l.value === value && (
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
