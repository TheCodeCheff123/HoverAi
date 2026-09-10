import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import HoverAiLogo from './Logo'

const NAV_LINKS = [
  { label: 'Features',     href: '#features' },
  { label: 'How it Works', href: '#how-it-works' },
  { label: 'Language',     href: '#languages' },
  { label: 'Pricing',      href: '#pricing' },
  { label: 'FAQ',          href: '#faq' },
]

const SPACER_H = 120
const DOCKED_TOP = 16
const REST_TOP = Math.round((SPACER_H - 52) / 2)

export default function Header() {
  const [open, setOpen]       = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    // "scrolled" = user has moved away from the very top
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className="fixed left-0 right-0 z-50 flex items-center justify-center transition-[top,padding] duration-300 ease-out"
      style={{
        top:          scrolled ? DOCKED_TOP : REST_TOP,
        paddingLeft:  scrolled ? 16 : 0,
        paddingRight: scrolled ? 16 : 0,
      }}
    >
      {/* Pill wrapper */}
      <div
        className='flex items-center justify-between w-full md:max-w-[90%] p-5 sm:px-6 md:border md:border-[var(--color-brand-400)] transition-[border-radius] duration-300 md:rounded-full'
        style={{
          background: 'rgba(10,10,10,0.75)',
          backdropFilter: 'blur(14px) saturate(180%)',
          WebkitBackdropFilter: 'blur(14px) saturate(180%)',
        }}
      >
        {/* Logo */}
        <HoverAiLogo />

        {/* Desktop nav links */}
        <nav className="hidden md:flex items-center gap-10">
          {NAV_LINKS.map(l => (
            <a
              key={l.label}
              href={l.href}
              className="text-[15px] text-white/70 hover:text-white transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-6">
          <a
            href="#pricing"
            className="hidden md:block text-[15px] text-white/80 hover:text-white transition-colors"
          >
            Sign In
          </a>
          <Link
            to="/signup"
            className="text-[14px] sm:text-[15px] font-semibold px-5 sm:px-6 py-2.5 rounded-full text-white transition-opacity hover:opacity-90 whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg, #615fff 0%, #432dd7 100%)' }}
          >
            Get Started Free
          </Link>

          {/* Mobile hamburger */}
          <button
            className="md:hidden flex flex-col gap-[5px] ml-2"
            onClick={() => setOpen(o => !o)}
            aria-label="Toggle menu"
          >
            <span className="w-5 h-0.5 bg-white rounded" />
            <span className="w-5 h-0.5 bg-white rounded" />
            <span className="w-3 h-0.5 bg-white rounded" />
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div
          className="absolute top-full left-0 right-0 mt-2 mx-4 rounded-2xl p-5 flex flex-col gap-3 md:hidden"
          style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {NAV_LINKS.map(l => (
            <a
              key={l.label}
              href={l.href}
              className="text-[16px] text-white/80 hover:text-white py-1"
              onClick={() => setOpen(false)}
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </header>
  )
}
