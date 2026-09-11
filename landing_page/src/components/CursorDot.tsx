import { useEffect, useRef } from 'react'

/**
 * A small dot that follows the mouse cursor.
 * Only rendered on pointer-capable (non-touch) devices — i.e. laptops/desktops.
 */
export default function CursorDot() {
  const dotRef = useRef<HTMLDivElement>(null)
  // Track raw target position
  const target = useRef({ x: -100, y: -100 })
  // Track smoothed position
  const current = useRef({ x: -100, y: -100 })
  const rafId = useRef<number>(0)

  useEffect(() => {
    // Only activate on devices that support a fine pointer (mouse/trackpad)
    const mq = window.matchMedia('(pointer: fine)')
    if (!mq.matches) return

    const dot = dotRef.current
    if (!dot) return

    const onMove = (e: MouseEvent) => {
      target.current = { x: e.clientX, y: e.clientY }
    }

    const animate = () => {
      // Lerp — 0.18 gives a subtle, smooth lag
      const ease = 0.18
      current.current.x += (target.current.x - current.current.x) * ease
      current.current.y += (target.current.y - current.current.y) * ease

      dot.style.transform = `translate(${current.current.x}px, ${current.current.y}px)`
      rafId.current = requestAnimationFrame(animate)
    }

    window.addEventListener('mousemove', onMove)
    rafId.current = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(rafId.current)
    }
  }, [])

  return (
    <div
      ref={dotRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: '#615fff', // brand-500
        pointerEvents: 'none',
        zIndex: 9999,
        // Centre the dot on the cursor tip
        marginTop: -4,
        marginLeft: -4,
        willChange: 'transform',
      }}
    />
  )
}
