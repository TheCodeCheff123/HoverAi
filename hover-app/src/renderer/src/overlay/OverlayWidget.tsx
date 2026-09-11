import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ─── Sub-panel types ─────────────────────────────────────────────────────────
type Panel = 'history' | 'settings' | null

export default function OverlayWidget() {
  const [hovered, setHovered] = useState(false)
  const [micActive, setMicActive] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [dragging, setDragging] = useState(false)

  const ease = [0.22, 1, 0.36, 1] as const

  // ── Drag-to-move ───────────────────────────────────────────────────────────
  // The overlay window is focusable:false so OS window-drag won't work.
  // We track pointer offset on mousedown, then send absolute screen positions
  // on mousemove to the main process which calls win.setPosition().
  const dragRef = useRef<{ startX: number; startY: number; winX: number; winY: number } | null>(null)

  const onMicMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start drag on left-button hold, not a quick click
    if (e.button !== 0) return
    e.preventDefault()

    // screenX/Y give us cursor position in screen coordinates
    const { screenX, screenY } = e
    // Current window position — electron-vite makes window.screenX/Y available
    const winX = window.screenX
    const winY = window.screenY

    dragRef.current = { startX: screenX, startY: screenY, winX, winY }
    setDragging(true)

    function onMouseMove(me: MouseEvent) {
      if (!dragRef.current) return
      const dx = me.screenX - dragRef.current.startX
      const dy = me.screenY - dragRef.current.startY
      window.api.overlayMove(dragRef.current.winX + dx, dragRef.current.winY + dy)
    }

    function onMouseUp() {
      dragRef.current = null
      setDragging(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  function openPanel(p: Panel) {
    // Don't open panels if we just finished a drag
    if (dragging) return
    setPanel(prev => prev === p ? null : p)
  }

  return (
    <>
      {/* ── Full-screen panel overlays (history / settings) ──────────── */}
      <AnimatePresence>
        {panel !== null && (
          <motion.div
            key="panel-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPanel(null)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.01)',
              zIndex: 10,
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panel !== null && (
          <motion.div
            key={`panel-${panel}`}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: 0.25, ease } }}
            exit={{ opacity: 0, scale: 0.95, y: 8, transition: { duration: 0.18 } }}
            style={{
              position: 'fixed',
              bottom: 212,
              right: 16,
              width: 280,
              height: 360,
              borderRadius: 20,
              background: '#161616',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
              zIndex: 20,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
          >
            <i
              className={panel === 'history' ? 'ri-history-line' : 'ri-settings-3-line'}
              style={{ fontSize: 32, color: 'rgba(255,255,255,0.15)' }}
            />
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', fontWeight: 500 }}>
              {panel === 'history' ? 'History' : 'Settings'} coming soon
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Widget root — bottom-right, stacks vertically ────────────── */}
      <div
        onMouseEnter={() => { setHovered(true); window.api.overlayMouseActive(true) }}
        onMouseLeave={() => { setHovered(false); window.api.overlayMouseActive(false) }}
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
          zIndex: 30,
        }}
      >
        {/* ── Controls pill (history + settings) — reveals on hover ──── */}
        <AnimatePresence>
          {hovered && (
            <motion.div
              key="controls-pill"
              initial={{ opacity: 0, y: 12, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease } }}
              exit={{ opacity: 0, y: 8, scale: 0.92, transition: { duration: 0.18 } }}
              style={{
                display: 'flex',
                alignItems: 'center',
                borderRadius: 999,
                background: '#1c1c1c',
                border: '1px solid rgba(255,255,255,0.09)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.55)',
                overflow: 'hidden',
                WebkitAppRegion: 'no-drag',
              } as React.CSSProperties}
            >
              <button
                onClick={() => openPanel('history')}
                style={iconBtnStyle}
                title="History"
              >
                <i className="ri-history-line" style={{ fontSize: 19, color: panel === 'history' ? '#fff' : '#888' }} />
              </button>
              <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
              <button
                onClick={() => openPanel('settings')}
                style={iconBtnStyle}
                title="Settings"
              >
                <i className="ri-settings-3-line" style={{ fontSize: 19, color: panel === 'settings' ? '#fff' : '#888' }} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── HoverAi tray — reveals on hover ──────────────────────── */}
        <AnimatePresence>
          {hovered && (
            <motion.div
              key="tray-pill"
              initial={{ opacity: 0, y: 10, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, delay: 0.04, ease } }}
              exit={{ opacity: 0, y: 8, scale: 0.92, transition: { duration: 0.16 } }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 16px 10px 16px',
                borderRadius: 999,
                background: '#1c1c1c',
                border: '1px solid rgba(255,255,255,0.09)',
                boxShadow: '0 8px 32px rgba(108,99,255,0.35), 0 2px 8px rgba(0,0,0,0.5)',
                WebkitAppRegion: 'drag',
                userSelect: 'none',
                minWidth: 160,
              } as React.CSSProperties}
            >
              {/* Branding + status */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, WebkitAppRegion: 'drag' } as React.CSSProperties}>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#fff', letterSpacing: '-0.01em', lineHeight: 1 }}>
                  HoverAi
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {/* Pulsing green dot */}
                  <span style={{ position: 'relative', width: 7, height: 7, flexShrink: 0, display: 'inline-block' }}>
                    <span style={{
                      position: 'absolute', inset: 0, borderRadius: '50%',
                      background: '#22c55e',
                      animation: 'pulse-ring 2s ease-out infinite',
                    }} />
                    <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#22c55e' }} />
                  </span>
                  <span style={{ fontSize: 12, color: '#777', fontWeight: 500 }}>Guiding you</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Mic button — always visible, press-hold to drag ──────── */}
        <motion.button
          onClick={() => { if (!dragging) setMicActive(v => !v) }}
          onMouseDown={onMicMouseDown}
          whileHover={{ scale: dragging ? 1 : 1.08 }}
          whileTap={{ scale: dragging ? 1 : 0.93 }}
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            border: 'none',
            cursor: dragging ? 'grabbing' : 'grab',
            background: '#6c63ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: micActive
              ? '0 0 0 5px rgba(108,99,255,0.25), 0 0 0 10px rgba(108,99,255,0.1), 0 8px 24px rgba(108,99,255,0.6)'
              : '0 0 0 1px rgba(255,255,255,0.08), 0 8px 24px rgba(108,99,255,0.45)',
            transition: 'box-shadow 0.25s',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          <i
            className={micActive ? 'ri-mic-fill' : 'ri-mic-line'}
            style={{ fontSize: 22, color: '#fff', pointerEvents: 'none' }}
          />
        </motion.button>
      </div>

      <style>{`
        @keyframes pulse-ring {
          0%   { transform: scale(1);   opacity: 1; }
          70%  { transform: scale(2.4); opacity: 0; }
          100% { transform: scale(2.4); opacity: 0; }
        }
      `}</style>
    </>
  )
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '10px 14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties
