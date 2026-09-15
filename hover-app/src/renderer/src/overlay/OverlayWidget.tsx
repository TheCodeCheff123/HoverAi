import { useEffect, useRef, useState, useCallback, type RefObject } from 'react'
import type { AgentResponse } from '@renderer/../../src/preload/index.d'

// ─── State machine ────────────────────────────────────────────────────────────
// idle → speaking → loading → agent (repeating turns) → done | error → idle
//
// speaking: mic starts immediately on capture-start, floating widget shown
//           → press Space / Enter / click Done to submit
//           → Escape cancels back to idle
// agent:    shows a single beacon per turn while the agent executes actions
// done:     final summary card + TTS plays, auto-dismiss after 12s

type OverlayState =
  | { kind: 'idle' }
  | { kind: 'speaking'; stream: MediaStream | null }
  | { kind: 'loading' }
  | { kind: 'agent'; resp: AgentResponse }
  | { kind: 'done'; resp: AgentResponse }
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
  const submitQuery = useCallback(async () => {
    setState({ kind: 'loading' })
    const audioBytes = await stopRecording()
    window.api.captureDone({ audioData: Array.from(audioBytes) })
  }, [stopRecording])

  // ── Listen for capture-start / capture-end from main ──────────────────────
  useEffect(() => {
    const unsubStart = window.api.onCaptureStart(async () => {
      // Play a short "on it" chime immediately — perceived latency drops dramatically
      playChime()
      // Mic starts immediately — no region selection step
      await startRecording()
      setState({ kind: 'speaking', stream: streamRef.current })
    })
    const unsubEnd = window.api.onCaptureEnd(() => {
      setState({ kind: 'idle' })
      stopRecording().catch(() => {})
    })
    return () => {
      unsubStart()
      unsubEnd()
    }
  }, [startRecording, stopRecording])

  // ── Listen for agent events pushed from main ──────────────────────────────
  useEffect(() => {
    const unsubTurn = window.api.onAgentTurn((resp) => {
      setState({ kind: 'agent', resp })
    })
    const unsubDone = window.api.onAgentDone((resp) => {
      setState({ kind: 'done', resp })
      if (resp.speech_b64) playAudio(resp.speech_b64)
    })
    const unsubError = window.api.onAgentError((message) => {
      setState({ kind: 'error', message })
    })
    return () => { unsubTurn(); unsubDone(); unsubError() }
  }, [])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    if (state.kind === 'idle') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (state.kind === 'speaking') {
          stopRecording().then(() => window.api.captureDone(null))
        } else {
          setState({ kind: 'idle' })
        }
        return
      }
      if ((e.key === ' ' || e.key === 'Enter') && state.kind === 'speaking') {
        e.preventDefault()
        submitQuery()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, stopRecording, submitQuery])

  // ─── Render ────────────────────────────────────────────────────────────────

  if (state.kind === 'idle') return null

  return (
    <>
      {state.kind === 'speaking' && (
        <SpeakingOverlay
          stream={state.stream}
          onSubmit={submitQuery}
          onCancel={() => stopRecording().then(() => window.api.captureDone(null))}
        />
      )}

      {state.kind === 'loading' && <LoadingOverlay />}

      {state.kind === 'agent' && (
        <AgentTurnOverlay resp={state.resp} />
      )}

      {state.kind === 'done' && (
        <AgentDoneOverlay resp={state.resp} onDismiss={() => setState({ kind: 'idle' })} />
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

/**
 * Short two-tone "on it" chime synthesised via Web Audio API — no file needed.
 * Plays immediately on shortcut press so the user gets instant feedback
 * while the backend is still processing.
 */
function playChime(): void {
  try {
    const ctx = new AudioContext()
    // Two ascending sine tones: 880 Hz → 1320 Hz, 80ms each, soft volume
    const tones = [880, 1320]
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.09)
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.09 + 0.01)
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.09 + 0.08)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.09)
      osc.stop(ctx.currentTime + i * 0.09 + 0.09)
    })
    // Close context after tones finish
    setTimeout(() => ctx.close(), 400)
  } catch {
    // Audio not critical — swallow errors silently
  }
}

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

// ─── Speaking overlay — transparent, floating widget bottom-centre ────────────

function SpeakingOverlay({
  stream,
  onSubmit,
  onCancel,
}: {
  stream: MediaStream | null
  onSubmit: () => void
  onCancel: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useAudioVisualiser(canvasRef, stream)

  return (
    // Overlay is fully transparent — real screen shows through. Only the widget
    // itself intercepts pointer events (pointerEvents: 'none' on the root).
    <div style={{ position: 'fixed', inset: 0, userSelect: 'none', pointerEvents: 'none' }}>

      {/* Floating widget — bottom-centre, pointerEvents re-enabled */}
      <div style={{
        position: 'absolute',
        bottom: 40,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 300,
        background: 'rgba(10, 10, 14, 0.92)',
        border: '1px solid rgba(108,99,255,0.55)',
        borderRadius: 18,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        pointerEvents: 'all',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(108,99,255,0.15)',
      }}>

        {/* Header row — red dot + label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0,
            animation: 'mic-pulse 1s ease-in-out infinite', display: 'block',
          }} />
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Listening…
          </span>
          <span style={{ marginLeft: 'auto', color: '#555', fontSize: 11 }}>
            HoverAI
          </span>
        </div>

        {/* Live audio visualiser */}
        <canvas
          ref={canvasRef}
          width={260}
          height={40}
          style={{ width: '100%', height: 40, borderRadius: 8, display: 'block' }}
        />

        <p style={{ color: '#666', fontSize: 12, margin: 0, textAlign: 'center' }}>
          <Kbd>Space</Kbd> or <Kbd>Enter</Kbd> to send · <Kbd>Esc</Kbd> to cancel
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
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'transparent',
            color: '#666',
            fontSize: 13,
            cursor: 'pointer',
            width: '100%',
          }}
        >
          Cancel
        </button>
      </div>

      <style>{`
        @keyframes mic-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.15; } }
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

// ─── Agent turn overlay — single beacon for the current action ────────────────

function AgentTurnOverlay({ resp }: { resp: AgentResponse }) {
  const action = resp.action!
  const cx = action.x * window.innerWidth
  const cy = action.y * window.innerHeight

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
      {/* Beacon at action target */}
      <div style={{ position: 'absolute', left: cx, top: cy }}>
        {/* Pulsing ring */}
        <div style={{
          position: 'absolute', left: -20, top: -20, width: 40, height: 40,
          borderRadius: '50%', background: 'rgba(108,99,255,0.3)',
          animation: 'beacon-ring 1.2s ease-out infinite',
        }} />
        {/* Solid dot */}
        <div style={{
          position: 'absolute', transform: 'translate(-50%,-50%)',
          width: 28, height: 28, borderRadius: '50%', background: '#6c63ff',
          border: '2px solid #fff', boxShadow: '0 2px 12px rgba(108,99,255,0.7)',
          animation: 'beacon-pop 0.35s cubic-bezier(0.22,1,0.36,1) forwards', opacity: 0,
        }} />
      </div>

      {/* Instruction chip — bottom centre */}
      <div style={{
        position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(10,10,14,0.92)', border: '1px solid rgba(108,99,255,0.45)',
        borderRadius: 12, padding: '10px 18px', color: '#fff', fontSize: 13,
        fontWeight: 500, whiteSpace: 'nowrap', pointerEvents: 'none',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ color: '#6c63ff', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>
          TURN {resp.turn}
        </span>
        {action.instruction}
      </div>

      <style>{`
        @keyframes beacon-ring { 0% { transform: scale(1); opacity: 0.8; } 100% { transform: scale(2.6); opacity: 0; } }
        @keyframes beacon-pop  { 0% { transform: translate(-50%,-50%) scale(0); opacity: 0; } 60% { transform: translate(-50%,-50%) scale(1.2); opacity: 1; } 100% { transform: translate(-50%,-50%) scale(1); opacity: 1; } }
      `}</style>
    </div>
  )
}

// ─── Agent done overlay — final summary + auto-dismiss ───────────────────────

function AgentDoneOverlay({ resp, onDismiss }: { resp: AgentResponse; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 12000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }} onClick={onDismiss}>
      {/* Subtle veil */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.2)', pointerEvents: 'none' }} />

      {/* Summary card */}
      <div style={{
        position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(10,10,14,0.94)', border: '1px solid rgba(108,99,255,0.4)',
        borderRadius: 16, padding: '16px 24px', maxWidth: 540, color: '#fff',
        fontSize: 14, lineHeight: 1.6, pointerEvents: 'all', backdropFilter: 'blur(12px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ color: '#6c63ff', fontSize: 18 }}>✦</span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Done</span>
          <span style={{ marginLeft: 'auto', color: '#555', fontSize: 11 }}>
            {resp.turn} turn{resp.turn !== 1 ? 's' : ''}
          </span>
        </div>
        <p style={{ margin: 0, color: '#ccc' }}>{resp.summary}</p>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#555' }}>
          Click anywhere or press Esc to dismiss
        </p>
      </div>
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
