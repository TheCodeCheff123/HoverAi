import { useEffect, useRef, useState, useCallback, type RefObject } from 'react'
import type { QueryResult, BeaconStep } from '@renderer/../../src/preload/index.d'

// ─── State machine ────────────────────────────────────────────────────────────
// idle → selecting → speaking → loading → result | error → idle
//
// selecting: frozen screenshot shown, user drags to pick a region
// speaking:  region locked in, mic is recording, user speaks their query
//            → press Space / Enter / click the button to submit
//            → Escape cancels back to idle

type CaptureRegion = { x: number; y: number; w: number; h: number }

type OverlayState =
  | { kind: 'idle' }
  | { kind: 'selecting'; screenshot: string; shortcutKey: string }
  | { kind: 'speaking'; screenshot: string; region: CaptureRegion; stream: MediaStream | null }
  | { kind: 'loading' }
  | { kind: 'result'; data: QueryResult }
  | { kind: 'error'; message: string }

export default function OverlayWidget() {
  const [state, setState] = useState<OverlayState>({ kind: 'idle' })

  // Audio recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // Pick the best supported mimeType — Electron on Windows may not support audio/webm
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/mp4',
      ].find((m) => MediaRecorder.isTypeSupported(m)) ?? ''

      console.log('[overlay] MediaRecorder mimeType:', mimeType || '(browser default)')

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.start()
      mediaRecorderRef.current = recorder
    } catch (err) {
      console.error('[overlay] failed to start audio recording:', err)
    }
  }, [])

  const stopRecording = useCallback((): Promise<Uint8Array> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Uint8Array(0))
        return
      }
      recorder.onstop = async () => {
        const mimeType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        console.log('[overlay] audio blob size:', blob.size, 'bytes, type:', mimeType)
        const buf = await blob.arrayBuffer()
        resolve(new Uint8Array(buf))
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        mediaRecorderRef.current = null
      }
      recorder.stop()
    })
  }, [])

  // ── Submit: stop recording and send to main ───────────────────────────────
  const submitQuery = useCallback(
    async (region: CaptureRegion) => {
      setState({ kind: 'loading' })
      const audioBytes = await stopRecording()
      window.api.captureDone({
        region,
        audioData: Array.from(audioBytes),
      })
    },
    [stopRecording],
  )

  // ── Listen for capture-start / capture-end from main ──────────────────────
  useEffect(() => {
    const unsubStart = window.api.onCaptureStart((dataUrl, key) => {
      // Just show the frozen screenshot — do NOT start recording yet
      setState({ kind: 'selecting', screenshot: dataUrl, shortcutKey: key })
    })
    const unsubEnd = window.api.onCaptureEnd(() => {
      setState({ kind: 'idle' })
      stopRecording().catch(() => {})
    })
    return () => {
      unsubStart()
      unsubEnd()
    }
  }, [stopRecording])

  // ── Listen for query results pushed from main ─────────────────────────────
  useEffect(() => {
    const unsubResult = window.api.onQueryResult((result) => {
      setState({ kind: 'result', data: result })
      if (result.speech_b64) playAudio(result.speech_b64)
    })
    const unsubError = window.api.onQueryError((message) => {
      setState({ kind: 'error', message })
    })
    return () => {
      unsubResult()
      unsubError()
    }
  }, [])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    if (state.kind === 'idle') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (state.kind === 'speaking') {
          stopRecording().then(() => window.api.captureDone(null))
        } else if (state.kind === 'selecting') {
          window.api.captureDone(null)
        } else {
          setState({ kind: 'idle' })
        }
        return
      }
      // Space or Enter while speaking → submit
      if ((e.key === ' ' || e.key === 'Enter') && state.kind === 'speaking') {
        e.preventDefault()
        submitQuery(state.region)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, stopRecording, submitQuery])

  // ── Drag handlers (selecting state only) ─────────────────────────────────
  const dragRef = useRef<{ startX: number; startY: number } | null>(null)
  const [dragRect, setDragRect] = useState<CaptureRegion | null>(null)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (state.kind !== 'selecting') return
      if (e.button !== 0) return
      dragRef.current = { startX: e.clientX, startY: e.clientY }
      setDragRect(null)
    },
    [state.kind],
  )

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragRef.current || state.kind !== 'selecting') return
      const { startX, startY } = dragRef.current
      setDragRect({
        x: Math.min(startX, e.clientX),
        y: Math.min(startY, e.clientY),
        w: Math.abs(e.clientX - startX),
        h: Math.abs(e.clientY - startY),
      })
    },
    [state.kind],
  )

  const onMouseUp = useCallback(
    async (e: React.MouseEvent) => {
      if (!dragRef.current || state.kind !== 'selecting') return
      const { startX, startY } = dragRef.current
      dragRef.current = null
      setDragRect(null)

      const x = Math.min(startX, e.clientX)
      const y = Math.min(startY, e.clientY)
      const w = Math.abs(e.clientX - startX)
      const h = Math.abs(e.clientY - startY)

      if (w < 8 || h < 8) {
        // Too small — ignore, let them try again
        return
      }

      const region: CaptureRegion = { x, y, w, h }

      // Region confirmed — NOW start recording
      await startRecording()
      setState({ kind: 'speaking', screenshot: state.screenshot, region, stream: streamRef.current })
    },
    [state, startRecording],
  )

  // ─── Render ────────────────────────────────────────────────────────────────

  if (state.kind === 'idle') return null

  return (
    <>
      {state.kind === 'selecting' && (
        <SelectingOverlay
          screenshot={state.screenshot}
          shortcutKey={state.shortcutKey}
          dragRect={dragRect}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
        />
      )}

      {state.kind === 'speaking' && (
        <SpeakingOverlay
          screenshot={state.screenshot}
          region={state.region}
          stream={state.stream}
          onSubmit={() => submitQuery(state.region)}
          onCancel={() => {
            stopRecording().then(() => window.api.captureDone(null))
          }}
        />
      )}

      {state.kind === 'loading' && <LoadingOverlay />}

      {state.kind === 'result' && (
        <ResultOverlay data={state.data} onDismiss={() => setState({ kind: 'idle' })} />
      )}

      {state.kind === 'error' && (
        <ErrorOverlay
          message={state.message}
          onDismiss={() => setState({ kind: 'idle' })}
        />
      )}
    </>
  )
}

// ─── Audio playback ───────────────────────────────────────────────────────────

function playAudio(base64Wav: string): void {
  try {
    const binary = atob(base64Wav)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const ctx = new AudioContext()
    ctx.decodeAudioData(bytes.buffer, (buffer) => {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.start()
    })
  } catch (err) {
    console.error('[overlay] audio playback error:', err)
  }
}

// ─── Selecting overlay — drag to pick region ─────────────────────────────────

function SelectingOverlay({
  screenshot,
  shortcutKey,
  dragRect,
  onMouseDown,
  onMouseMove,
  onMouseUp,
}: {
  screenshot: string
  shortcutKey: string
  dragRect: CaptureRegion | null
  onMouseDown: (e: React.MouseEvent) => void
  onMouseMove: (e: React.MouseEvent) => void
  onMouseUp: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      style={{ position: 'fixed', inset: 0, cursor: 'crosshair', userSelect: 'none', background: '#0a0a0a' }}
    >
      {/* Frozen screenshot */}
      <img
        src={screenshot}
        draggable={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />

      {/* Dark veil */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />

      {/* Pulsing border */}
      <div style={{
        position: 'absolute', inset: 0, border: '3px solid #6c63ff',
        pointerEvents: 'none', animation: 'capture-pulse 1.4s ease-in-out infinite',
      }} />

      {/* Instruction hint */}
      {!dragRect && (
        <div style={{
          position: 'absolute', top: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.82)', border: '1px solid rgba(108,99,255,0.5)',
          borderRadius: 10, padding: '10px 20px', color: '#fff', fontSize: 14,
          fontWeight: 600, whiteSpace: 'nowrap', pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          ✦ Drag to select a region
          <span style={{ color: '#888', fontWeight: 400 }}>
            · Esc to cancel{shortcutKey ? ` · ${shortcutKey}` : ''}
          </span>
        </div>
      )}

      {/* Selection rectangle */}
      {dragRect && dragRect.w > 0 && dragRect.h > 0 && (
        <>
          <div style={{
            position: 'absolute', left: dragRect.x, top: dragRect.y,
            width: dragRect.w, height: dragRect.h,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)', pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', left: dragRect.x, top: dragRect.y,
            width: dragRect.w, height: dragRect.h,
            border: '2px solid #6c63ff', borderRadius: 2,
            boxShadow: '0 0 0 1px rgba(108,99,255,0.4)', pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', left: dragRect.x, top: dragRect.y + dragRect.h + 6,
            background: '#6c63ff', borderRadius: 4, padding: '2px 7px',
            fontSize: 11, fontWeight: 600, color: '#fff', pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>
            {Math.round(dragRect.w)} × {Math.round(dragRect.h)}
          </div>
        </>
      )}

      <style>{`@keyframes capture-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }`}</style>
    </div>
  )
}

// ─── Audio visualiser hook ────────────────────────────────────────────────────

function useAudioVisualiser(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  stream: MediaStream | null,
) {
  useEffect(() => {
    if (!stream || !canvasRef.current) return

    const audioCtx = new AudioContext()
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 64                 // 32 bars — lightweight
    analyser.smoothingTimeConstant = 0.75 // smooth decay

    const source = audioCtx.createMediaStreamSource(stream)
    source.connect(analyser)

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')!
    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    let rafId = 0

    const draw = () => {
      rafId = requestAnimationFrame(draw)
      analyser.getByteFrequencyData(dataArray)

      const { width: W, height: H } = canvas
      ctx.clearRect(0, 0, W, H)

      const barW = Math.floor((W - (bufferLength - 1)) / bufferLength)
      let x = 0
      for (let i = 0; i < bufferLength; i++) {
        const pct = dataArray[i] / 255          // 0–1
        const barH = Math.max(3, Math.round(pct * H))

        // Colour: soft purple at low amplitude → bright accent at peak
        const alpha = 0.45 + pct * 0.55
        ctx.fillStyle = `rgba(108, 99, 255, ${alpha.toFixed(2)})`
        ctx.beginPath()
        ctx.roundRect(x, H - barH, barW, barH, 2)
        ctx.fill()

        x += barW + 1
      }
    }

    draw()

    return () => {
      cancelAnimationFrame(rafId)
      source.disconnect()
      audioCtx.close()
    }
  }, [stream, canvasRef])
}

// ─── Speaking overlay — mic is live, user speaks their query ─────────────────

function SpeakingOverlay({
  screenshot,
  region,
  stream,
  onSubmit,
  onCancel,
}: {
  screenshot: string
  region: CaptureRegion
  stream: MediaStream | null
  onSubmit: () => void
  onCancel: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useAudioVisualiser(canvasRef, stream)

  return (
    <div style={{ position: 'fixed', inset: 0, userSelect: 'none' }}>
      {/* Frozen screenshot */}
      <img
        src={screenshot}
        draggable={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />

      {/* Dark veil outside selected region */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />

      {/* Cut-out — reveal the selected region */}
      <div style={{
        position: 'absolute', left: region.x, top: region.y,
        width: region.w, height: region.h,
        boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
        outline: '2px solid #6c63ff',
        pointerEvents: 'none',
      }} />

      {/* Mic recording panel — anchored below the selected region */}
      <div style={{
        position: 'absolute',
        left: region.x,
        top: region.y + region.h + 12,
        minWidth: 280,
        background: 'rgba(0,0,0,0.88)',
        border: '1px solid rgba(108,99,255,0.5)',
        borderRadius: 14,
        padding: '14px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        {/* Mic indicator row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0,
            animation: 'mic-pulse 1s ease-in-out infinite', display: 'block',
          }} />
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
            Speak your question…
          </span>
        </div>

        {/* Audio visualiser */}
        <canvas
          ref={canvasRef}
          width={244}
          height={36}
          style={{ width: '100%', height: 36, borderRadius: 6, display: 'block' }}
        />

        <p style={{ color: '#888', fontSize: 12, margin: 0 }}>
          Press <Kbd>Space</Kbd> or <Kbd>Enter</Kbd> when done · <Kbd>Esc</Kbd> to cancel
        </p>

        {/* Submit button */}
        <button
          onClick={onSubmit}
          style={{
            padding: '10px 0',
            borderRadius: 999,
            border: 'none',
            background: '#6c63ff',
            color: '#fff',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            width: '100%',
          }}
        >
          Done — send query ↵
        </button>

        <button
          onClick={onCancel}
          style={{
            padding: '6px 0',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'transparent',
            color: '#888',
            fontSize: 13,
            cursor: 'pointer',
            width: '100%',
          }}
        >
          Cancel
        </button>
      </div>

      <style>{`
        @keyframes mic-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
      `}</style>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: 4, padding: '1px 5px', fontSize: 11, fontFamily: 'inherit', color: '#ccc',
    }}>
      {children}
    </kbd>
  )
}

// ─── Loading overlay ──────────────────────────────────────────────────────────

function LoadingOverlay() {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
    }}>
      <i className="ri-loader-4-line" style={{ fontSize: 40, color: '#6c63ff', animation: 'spin 0.8s linear infinite' }} />
      <p style={{ color: '#fff', fontSize: 15, fontWeight: 600, margin: 0 }}>Thinking…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─── Result overlay — beacon dots ────────────────────────────────────────────

function ResultOverlay({ data, onDismiss }: { data: QueryResult; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 12000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }} onClick={onDismiss}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)' }} />

      {data.steps.map((step) => (
        <BeaconDot key={step.step} step={step} />
      ))}

      <div style={{
        position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.88)', border: '1px solid rgba(108,99,255,0.4)',
        borderRadius: 14, padding: '14px 22px', maxWidth: 520, color: '#fff',
        fontSize: 14, lineHeight: 1.6, pointerEvents: 'all', backdropFilter: 'blur(12px)',
      }}>
        <p style={{ margin: 0 }}>{data.summary}</p>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#888' }}>
          Click anywhere or press Esc to dismiss
        </p>
      </div>

      <style>{`
        @keyframes beacon-ring { 0% { transform: scale(1); opacity: 0.8; } 100% { transform: scale(2.4); opacity: 0; } }
        @keyframes beacon-pop  { 0% { transform: translate(-50%,-50%) scale(0); opacity: 0; } 60% { transform: translate(-50%,-50%) scale(1.15); opacity: 1; } 100% { transform: translate(-50%,-50%) scale(1); opacity: 1; } }
      `}</style>
    </div>
  )
}

function BeaconDot({ step }: { step: BeaconStep }) {
  const [hovered, setHovered] = useState(false)
  const cx = step.x * window.innerWidth
  const cy = step.y * window.innerHeight

  return (
    <div
      style={{ position: 'absolute', left: cx, top: cy, pointerEvents: 'all' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        position: 'absolute', left: -18, top: -18, width: 36, height: 36,
        borderRadius: '50%', background: 'rgba(108,99,255,0.35)',
        animation: `beacon-ring 1.6s ease-out infinite`,
        animationDelay: `${(step.step - 1) * 0.3}s`,
      }} />
      <div style={{
        position: 'absolute', transform: 'translate(-50%,-50%)',
        width: 32, height: 32, borderRadius: '50%', background: '#6c63ff',
        border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 800, color: '#fff', cursor: 'default',
        boxShadow: '0 2px 12px rgba(108,99,255,0.6)',
        animation: `beacon-pop 0.4s cubic-bezier(0.22,1,0.36,1) forwards`,
        animationDelay: `${(step.step - 1) * 0.15}s`, opacity: 0,
      }}>
        {step.step}
      </div>
      {hovered && (
        <div style={{
          position: 'absolute', left: 20, top: -8,
          background: 'rgba(0,0,0,0.9)', border: '1px solid rgba(108,99,255,0.4)',
          borderRadius: 8, padding: '7px 12px', fontSize: 13, color: '#fff',
          whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none',
        } as React.CSSProperties}>
          {step.instruction}
        </div>
      )}
    </div>
  )
}

// ─── Error overlay ────────────────────────────────────────────────────────────

function ErrorOverlay({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onDismiss}>
      <div style={{
        background: 'rgba(20,20,20,0.95)', border: '1px solid rgba(239,68,68,0.4)',
        borderRadius: 16, padding: '24px 32px', maxWidth: 420, textAlign: 'center',
      }}>
        <i className="ri-error-warning-line" style={{ fontSize: 32, color: '#ef4444' }} />
        <p style={{ color: '#fff', fontSize: 15, fontWeight: 600, margin: '12px 0 6px' }}>Something went wrong</p>
        <p style={{ color: '#888', fontSize: 13, margin: '0 0 16px' }}>{message}</p>
        <button onClick={onDismiss} style={{
          padding: '9px 24px', borderRadius: 999, border: 'none',
          background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
        }}>
          Dismiss
        </button>
      </div>
    </div>
  )
}
