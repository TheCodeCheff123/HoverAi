/**
 * Smooth scroll to a section by id with a custom easing curve.
 *
 * The feel: starts slow, progressively accelerates, then gently settles —
 * like a physics-aware scroll. Duration scales with distance so a long
 * journey feels proportionally weighted vs a short hop.
 */

/** Cubic-bezier approximation evaluated at t ∈ [0,1].
 *  Using ease-in-out-cubic: slow → fast → settle */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (!el) return

  const startY   = window.scrollY
  const targetY  = el.getBoundingClientRect().top + startY - 80 // 80px header offset
  const distance = targetY - startY

  if (Math.abs(distance) < 2) return

  // Duration scales with distance: min 400ms, max 1200ms
  const duration = Math.min(1200, Math.max(400, Math.abs(distance) * 0.4))

  let startTime: number | null = null

  function step(timestamp: number) {
    if (startTime === null) startTime = timestamp
    const elapsed  = timestamp - startTime
    const progress = Math.min(elapsed / duration, 1)
    const eased    = easeInOutCubic(progress)

    window.scrollTo(0, startY + distance * eased)

    if (progress < 1) requestAnimationFrame(step)
  }

  requestAnimationFrame(step)
}

/** onClick handler factory — prevents default and scrolls. */
export function handleAnchorClick(
  e: React.MouseEvent<HTMLAnchorElement>,
  onDone?: () => void,
) {
  const href = (e.currentTarget as HTMLAnchorElement).getAttribute('href') ?? ''
  if (!href.startsWith('#')) return
  e.preventDefault()
  scrollToId(href.slice(1))
  history.pushState(null, '', href)
  onDone?.()
}
