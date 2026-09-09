import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

interface FadeUpProps {
  children: ReactNode
  /** Delay in seconds before the animation starts. Default: 0 */
  delay?: number
  /** How far the element slides up from. Default: 28px */
  distance?: number
  /** className forwarded to the motion div */
  className?: string
  /** Fraction of element that must be visible to trigger. Default: 0.15 */
  amount?: number
}

/**
 * Wraps children in a scroll-triggered fade-up animation.
 * Fires once when the element enters the viewport — never replays.
 */
export default function FadeUp({
  children,
  delay = 0,
  distance = 28,
  className,
  amount = 0.15,
}: FadeUpProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{
        duration: 0.6,
        delay,
        ease: [0.22, 1, 0.36, 1], // custom ease-out expo
      }}
    >
      {children}
    </motion.div>
  )
}
