const FOOTER_BG = '#3730a3' // brand indigo-800 approximation — matches the deep periwinkle in design

export default function LandingFooter() {
  return (
    <footer style={{ background: FOOTER_BG, overflow: 'hidden' }}>

      {/* ── Giant "HoverAi" wordmark ───────────────────────────────── */}
      <div
        aria-hidden="true"
        className="relative overflow-hidden"
        style={{ padding: '6vw 5vw 0' }}
      >
        {/* Logo mark (SVG from Logo.tsx duplicated large) */}
        <div className="absolute left-[3vw] top-[4vw] opacity-60">
          <svg width="22vw" height="auto" viewBox="0 0 57 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M51.2865 8.93283C53.184 10.1486 53.2719 12.2467 51.4827 13.6191C49.3816 15.2308 49.4848 17.6947 51.7131 19.1223L54.8222 21.1143C56.7198 22.33 56.8076 24.4281 55.0184 25.8006L51.1841 28.7418C49.3949 30.1142 46.4062 30.2413 44.5086 29.0256L31.8688 20.9275C29.9712 19.7118 29.8834 17.6137 31.6726 16.2412C33.7737 14.6295 33.6705 12.1657 31.4421 10.738L28.333 8.74607C26.4355 7.53034 26.3476 5.43221 28.1368 4.05976L31.9711 1.11856C33.7603 -0.253887 36.7491 -0.380937 38.6466 0.834791L51.2865 8.93283Z" fill="white"/>
            <path d="M24.4362 10.882C26.3337 12.0978 26.4216 14.1959 24.6324 15.5684C22.7103 17.0427 22.8047 19.2967 24.8432 20.6027L28.7887 23.1305C30.6863 24.3462 30.7741 26.4444 28.9849 27.8168L25.1506 30.758C23.3614 32.1305 20.3726 32.2575 18.4751 31.0418L5.83526 22.9438C3.93769 21.728 3.84985 19.6299 5.63904 18.2574C7.56114 16.7831 7.46676 14.5291 5.42825 13.2231L1.48267 10.6952C-0.414855 9.47949 -0.502734 7.38135 1.28646 6.00891L5.12078 3.06771C6.90997 1.69528 9.89871 1.56825 11.7963 2.78394L24.4362 10.882Z" fill="white"/>
          </svg>
        </div>

        {/* "HoverAi" text wordmark */}
        <p
          className="text-right font-extrabold leading-none tracking-tight select-none"
          style={{
            fontSize: 'clamp(60px, 12vw, 200px)',
            color: 'rgba(255,255,255,0.25)',
            fontFamily: "'CreatoDisplay', sans-serif",
            lineHeight: 1,
          }}
        >
          HoverAi
        </p>
      </div>

      {/* ── Links + tagline ─────────────────────────────────────────── */}
      <div
        className="max-w-[1100px] mx-auto px-5 sm:px-10 pt-10 pb-8 grid gap-10"
        style={{ gridTemplateColumns: '1fr auto auto auto' }}
      >
        {/* Tagline */}
        <p className="text-[14px] text-white/60 max-w-[200px] leading-relaxed">
          An agentic voice assistant for African creators — built to listen the way you actually speak.
        </p>

        {/* Product */}
        <div>
          <p className="text-[13px] font-semibold text-white mb-3">Product</p>
          <ul className="flex flex-col gap-2">
            {['Features', 'Pricing', 'Language'].map(l => (
              <li key={l}>
                <a href={`#${l.toLowerCase()}`} className="text-[13px] text-white/60 hover:text-white transition-colors">
                  {l}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Company */}
        <div>
          <p className="text-[13px] font-semibold text-white mb-3">Company</p>
          <ul className="flex flex-col gap-2">
            {['About', 'Contact'].map(l => (
              <li key={l}>
                <a href="#" className="text-[13px] text-white/60 hover:text-white transition-colors">{l}</a>
              </li>
            ))}
          </ul>
        </div>

        {/* Legal */}
        <div>
          <p className="text-[13px] font-semibold text-white mb-3">Product</p>
          <ul className="flex flex-col gap-2">
            {['Privacy Policy', 'Terms of Use'].map(l => (
              <li key={l}>
                <a href="#" className="text-[13px] text-white/60 hover:text-white transition-colors">{l}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Bottom bar ──────────────────────────────────────────────── */}
      <div
        className="max-w-[1100px] mx-auto px-5 sm:px-10 py-5 flex items-center justify-between flex-wrap gap-3"
        style={{ borderTop: '1px solid rgba(255,255,255,0.15)' }}
      >
        <p className="text-[13px] text-white/50">
          &copy; 2026 Hover AI. All rights reserved.
        </p>
        <p className="text-[13px] font-semibold text-white/70">
          Powered by MacedonLabs
        </p>
      </div>

    </footer>
  )
}
