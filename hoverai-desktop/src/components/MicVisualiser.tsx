import { useEffect, useRef } from 'react'

const BAR_COUNT = 28
const BAR_GAP = 3
const BAR_WIDTH = 4
const MIN_H = 3   // px — resting height
const MAX_H = 36  // px — peak height

// Maps a frequency bin value (0–255) to a bar height with a little curve
function toHeight(value: number): number {
  const normalised = value / 255
  // Slight power curve so quiet sounds still move the bars noticeably
  return MIN_H + (MAX_H - MIN_H) * Math.pow(normalised, 0.6)
}

export default function MicVisualiser() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream

        const ctx = new AudioContext()
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 128          // 64 frequency bins — enough for BAR_COUNT
        analyser.smoothingTimeConstant = 0.78  // smooths rapid changes
        source.connect(analyser)
        analyserRef.current = analyser

        const data = new Uint8Array(analyser.frequencyBinCount)
        const canvas = canvasRef.current
        if (!canvas) return
        const c = canvas.getContext('2d')!

        function draw() {
          if (cancelled || !analyserRef.current) return
          rafRef.current = requestAnimationFrame(draw)

          analyserRef.current.getByteFrequencyData(data)

          const { width, height } = canvas!
          c.clearRect(0, 0, width, height)

          // Sample BAR_COUNT bins evenly across the lower half of the spectrum
          // (human voice lives roughly in the first 40% of bins)
          const usableBins = Math.floor(data.length * 0.55)
          const step = usableBins / BAR_COUNT

          for (let i = 0; i < BAR_COUNT; i++) {
            const binIndex = Math.floor(i * step)
            const h = toHeight(data[binIndex])
            const x = i * (BAR_WIDTH + BAR_GAP)
            const y = (height - h) / 2  // centre bars vertically

            // Colour: accent purple, opacity driven by height
            const alpha = 0.35 + 0.65 * ((h - MIN_H) / (MAX_H - MIN_H))
            c.fillStyle = `rgba(108, 99, 255, ${alpha.toFixed(2)})`
            c.beginPath()
            c.roundRect(x, y, BAR_WIDTH, h, 2)
            c.fill()
          }
        }

        draw()
      } catch {
        // mic already granted but something went wrong — silently no-op
      }
    }

    start()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      analyserRef.current = null
    }
  }, [])

  const totalWidth = BAR_COUNT * (BAR_WIDTH + BAR_GAP) - BAR_GAP

  return (
    <canvas
      ref={canvasRef}
      width={totalWidth}
      height={MAX_H + 4}
      style={{ display: 'block' }}
      aria-hidden
    />
  )
}
