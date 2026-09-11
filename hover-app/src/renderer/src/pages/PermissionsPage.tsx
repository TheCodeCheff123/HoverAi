import { useState } from 'react'

interface PermissionsPageProps {
  onComplete: () => void
}

interface PermissionItem {
  id: 'microphone' | 'screen'
  label: string
  description: string
  icon: string
}

const PERMISSIONS: PermissionItem[] = [
  {
    id: 'microphone',
    label: 'Microphone',
    description: 'For voice commands',
    icon: 'ri-mic-line',
  },
  {
    id: 'screen',
    label: 'Screen recording',
    description: 'For visual context',
    icon: 'ri-computer-line',
  },
]

export default function PermissionsPage({ onComplete }: PermissionsPageProps) {
  const [granted, setGranted] = useState<Record<string, boolean>>({
    microphone: false,
    screen: true,
  })

  const allGranted = Object.values(granted).every(Boolean)

  function toggle(id: string) {
    setGranted((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div
      className="flex h-full w-full flex-col justify-between"
      style={{ padding: '52px 48px', background: 'var(--bg)' }}
    >
      {/* Header */}
      <div>
        <h1
          style={{
            fontSize: 38,
            fontWeight: 700,
            letterSpacing: '-0.025em',
            color: 'var(--text-primary)',
            marginBottom: 12,
          }}
        >
          Grant device access
        </h1>
        <p
          style={{
            fontSize: 16,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            maxWidth: 520,
          }}
        >
          Hover AI needs these to hear your commands and see what&apos;s on screen. Nothing leaves
          your device without your ask.
        </p>
      </div>

      {/* Permission cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: '40px 0' }}>
        {PERMISSIONS.map(({ id, label, description, icon }) => (
          <div
            key={id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '20px 24px',
              borderRadius: 'var(--radius-lg)',
              /* Glass card — same treatment as feature cards */
              background: [
                'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 100%) padding-box',
                'linear-gradient(135deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.06) 35%, rgba(255,255,255,0.01) 70%, rgba(255,255,255,0.005) 100%) border-box',
                'rgba(18,16,38,0.75) padding-box',
              ].join(', '),
              border: '1px solid transparent',
              boxShadow: '0 4px 24px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.25)',
            }}
          >
            {/* Icon box — micro glass */}
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 'var(--radius-md)',
                /* Micro glass — inset within the card */
                background: [
                  'linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.03) 60%, rgba(255,255,255,0.01) 100%) border-box',
                  'rgba(255,255,255,0.05) padding-box',
                ].join(', '),
                border: '1px solid transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <i className={icon} style={{ fontSize: 24, color: 'var(--text-secondary)' }} />
            </div>

            {/* Text */}
            <div style={{ flex: 1 }}>
              <p
                style={{
                  fontWeight: 700,
                  fontSize: 17,
                  color: 'var(--text-primary)',
                  marginBottom: 2,
                }}
              >
                {label}
              </p>
              <p style={{ fontSize: 15, color: 'var(--text-secondary)' }}>{description}</p>
            </div>

            {/* Toggle */}
            <button
              onClick={() => toggle(id)}
              role="switch"
              aria-checked={granted[id]}
              style={{
                width: 50,
                height: 28,
                borderRadius: 'var(--radius-full)',
                border: 'none',
                cursor: 'pointer',
                padding: 3,
                background: granted[id] ? 'var(--accent)' : '#3a3a3a',
                transition: 'background 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: granted[id] ? 'flex-end' : 'flex-start',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: '#fff',
                  display: 'block',
                  transition: 'all 0.2s',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                }}
              />
            </button>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <button
          onClick={allGranted ? onComplete : undefined}
          style={{
            width: '100%',
            padding: '16px 0',
            borderRadius: 'var(--radius-full)',
            border: 'none',
            cursor: allGranted ? 'pointer' : 'not-allowed',
            background: allGranted ? 'var(--accent)' : 'var(--accent)',
            opacity: allGranted ? 1 : 0.5,
            color: '#fff',
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            transition: 'opacity 0.2s, background 0.18s',
          }}
          onMouseEnter={(e) => {
            if (allGranted) e.currentTarget.style.background = 'var(--accent-hover)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--accent)'
          }}
        >
          Launch AI Overlay
        </button>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          {allGranted ? '\u00a0' : 'Enable both permissions to continue'}
        </p>
      </div>
    </div>
  )
}
