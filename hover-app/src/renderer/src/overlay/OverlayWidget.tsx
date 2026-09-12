import { useEffect, useRef, useState, useCallback } from 'react'

type CaptureRegion = { x: number; y: number; w: number; h: number }

type DragState = {
  startX: number
  startY: number
} | null

export default function OverlayWidget() {
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [shortcutKey, setShortcutKey] = useState('')
  const [drag, setDrag] = useState<DragState>(null)
  const [rect, setRect] = useState<CaptureRegion | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ── Listen for capture-start / capture-end from main ──────────────────────
  useEffect(() => {
    const unsubStart = window.api.onCaptureStart((dataUrl, key) => {
      setScreenshot(dataUrl)
      setShortcutKey(key)
      setDrag(null)
      setRect(null)
    })
    const unsubEnd = window.api.onCaptureEnd(() => {
      setScreenshot(null)
      setDrag(null)
      setRect(null)
    })
    return () => {
      unsubStart()
      unsubEnd()
    }
  }, [])

  // ── Keyboard: Escape cancels ───────────────────────────────────────────────
  useEffect(() => {
    if (!screenshot) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.api.captureDone(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screenshot])

  // ── Mouse handlers ─────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    setDrag({ startX: e.clientX, startY: e.clientY })
    setRect(null)
  }, [])

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drag) return
      const x = Math.min(drag.startX, e.clientX)
      const y = Math.min(drag.startY, e.clientY)
      const w = Math.abs(e.clientX - drag.startX)
      const h = Math.abs(e.clientY - drag.startY)
      setRect({ x, y, w, h })
    },
    [drag],
  )

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!drag) return
      const x = Math.min(drag.startX, e.clientX)
      const y = Math.min(drag.startY, e.clientY)
      const w = Math.abs(e.clientX - drag.startX)
      const h = Math.abs(e.clientY - drag.startY)
      setDrag(null)
      // Require a minimum selection size to avoid accidental clicks
      if (w < 8 || h < 8) {
        window.api.captureDone(null)
        return
      }
      window.api.captureDone({ x, y, w, h })
    },
    [drag],
  )

  // Not in capture mode — render nothing (transparent passthrough)
  if (!screenshot) return null

  return (
    <div
      ref={containerRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'crosshair',
        userSelect: 'none',
        // Fallback background if screenshot is blank — still shows capture mode is active
        background: '#0a0a0a',
      }}
    >
      {/* ── Frozen screenshot ──────────────────────────────────────── */}
      <img
        src={screenshot}
        draggable={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />

      {/* ── Dark vignette ──────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          pointerEvents: 'none',
        }}
      />

      {/* ── Pulsing border — unmistakable signal that capture is active */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          border: '3px solid #6c63ff',
          borderRadius: 0,
          pointerEvents: 'none',
          animation: 'capture-pulse 1.4s ease-in-out infinite',
        }}
      />

      {/* ── Instruction hint ───────────────────────────────────────── */}
      {!drag && !rect && (
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.82)',
            border: '1px solid rgba(108,99,255,0.5)',
            borderRadius: 10,
            padding: '10px 20px',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 4px 24px rgba(108,99,255,0.3)',
          }}
        >
          ✦ Drag to select a region &nbsp;·&nbsp;
          <span style={{ color: '#888', fontWeight: 400 }}>
            Esc to cancel{shortcutKey ? ` · ${shortcutKey}` : ''}
          </span>
        </div>
      )}

      {/* ── Selection rectangle ────────────────────────────────────── */}
      {rect && rect.w > 0 && rect.h > 0 && (
        <>
          {/* Cut-out: reveal the screenshot through the dark veil */}
          <div
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              background: 'transparent',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
              pointerEvents: 'none',
            }}
          />
          {/* Border */}
          <div
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              border: '2px solid #6c63ff',
              borderRadius: 2,
              boxShadow: '0 0 0 1px rgba(108,99,255,0.4)',
              pointerEvents: 'none',
            }}
          />
          {/* Size label */}
          <div
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y + rect.h + 6,
              background: '#6c63ff',
              borderRadius: 4,
              padding: '2px 7px',
              fontSize: 11,
              fontWeight: 600,
              color: '#fff',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {Math.round(rect.w)} × {Math.round(rect.h)}
          </div>
        </>
      )}
      <style>{`
        @keyframes capture-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
      `}</style>
    </div>
  )
}
